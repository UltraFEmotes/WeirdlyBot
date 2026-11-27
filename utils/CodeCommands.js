/**
 * !code — on-demand code generation
 *
 * Usage: !code <prompt> [--lang <language>] [--dm]
 *   - `--lang python` sets the target language; a leading bare language name
 *     (`!code python fizzbuzz`) or a trailing `dm`/`yes` also work.
 *
 * The command is consumed with priority before the chat pipeline: no
 * engagement judge, no batching, no humanizer. Generation runs with a
 * generous timeout so long files don't get cut off, and the code is NEVER
 * executed — it is only delivered as a source file with the matching
 * extension (`code.py`, `code.js`, ...). With `--dm`, the file goes to the
 * user's DMs when they are open and falls back to the channel when not.
 */

import { log, loadConfig } from "./functions.js";
import AIManager from "./AIManager.js";

const NO_MENTIONS = { parse: [], repliedUser: false };
// code generation can easily outlive the provider client's default 30s timeout
const GENERATION_TIMEOUT_MS = 300_000;
const MAX_ACTIVE = 2;
const active = new Set();

const LANGUAGE_EXTENSIONS = {
  python: "py", py: "py", python3: "py",
  javascript: "js", js: "js", node: "js", nodejs: "js",
  typescript: "ts", ts: "ts", tsx: "tsx", jsx: "jsx",
  java: "java", kotlin: "kt", kt: "kt", scala: "scala",
  c: "c", cpp: "cpp", "c++": "cpp", cxx: "cpp",
  csharp: "cs", "c#": "cs", cs: "cs",
  go: "go", golang: "go", rust: "rs", rs: "rs",
  ruby: "rb", rb: "rb", php: "php", swift: "swift",
  dart: "dart", lua: "lua", perl: "pl", pl: "pl",
  haskell: "hs", hs: "hs", elixir: "ex", erlang: "erl",
  clojure: "clj", groovy: "groovy", julia: "jl", jl: "jl",
  nim: "nim", zig: "zig", solidity: "sol", fortran: "f90",
  html: "html", htm: "html", css: "css", scss: "scss",
  sql: "sql", bash: "sh", shell: "sh", sh: "sh", zsh: "sh",
  powershell: "ps1", ps1: "ps1", batch: "bat", bat: "bat",
  json: "json", yaml: "yml", yml: "yml", xml: "xml",
  markdown: "md", md: "md", assembly: "asm", asm: "asm",
  r: "r", matlab: "matlab", vb: "vb", vba: "vba",
};

const CODING_SYSTEM_PROMPT = `you are a code generation engine. you write code on request and nothing else. you NEVER execute, run or test code — you only write it.

output format (strict):
- line 1: exactly \`LANG: <language>\` (for example \`LANG: python\`), nothing else on that line
- every line after that: the code itself — no explanations, no commentary, no markdown fences
- one single self-contained file: full imports and boilerplate, with a usage example as a trailing comment when useful
- if the request is vague, pick the most sensible interpretation and write the code anyway
- if the request isn't about code, still answer in the same format, with a short comment in the file explaining you only write code
- keep comments in the code rare and only where they genuinely help`;

const DM_TRUE_WORDS = /^(?:yes|y|true|dm|dms)$/i;
const DM_FALSE_WORDS = /^(?:no|n|false|nodm|nodms|no-dm|no-dms)$/i;
const DM_WORD = /^(?:yes|y|true|false|no|n|dm|dms|nodm|nodms|no-dm|no-dms)$/i;

/**
 * Parse "!code [language] [dm] <prompt>" — flags can sit anywhere, and the
 * shorthand forms (leading language, trailing dm word) are supported too.
 */
export function parseArgs(input) {
  let text = (input || "").trim();
  let language;
  let shouldDM = false;

  text = text.replace(/(^|\s)-{1,2}(?:lang|language)[=: ]+([a-z0-9+#]+)/i, (_, space, lang) => {
    language = lang.toLowerCase();
    return space;
  });
  text = text.replace(/(^|\s)-{1,2}no-?dm(?:s)?(?=\s|$)/i, () => { shouldDM = false; return " "; });
  text = text.replace(/(^|\s)-{1,2}dm(?:s)?(?=\s|$)/i, () => { shouldDM = true; return " "; });
  text = text.trim();

  // leading bare language: "!code python fizzbuzz"
  const leading = text.match(/^([a-z0-9+#]+)(?:\s+([\s\S]*))?$/i);
  if (!language && leading && LANGUAGE_EXTENSIONS[leading[1].toLowerCase()]) {
    language = leading[1].toLowerCase();
    text = (leading[2] || "").trim();
  }

  // trailing dm word: "!code a snake game dm" / "!code ... yes" / "!code ... no-dm"
  const trailing = text.match(/^([\s\S]*\S)\s+([a-z-]+)$/i);
  if (trailing && !DM_WORD.test(trailing[1].trim())) {
    if (DM_TRUE_WORDS.test(trailing[2])) {
      shouldDM = true;
      text = trailing[1].trim();
    } else if (DM_FALSE_WORDS.test(trailing[2])) {
      shouldDM = false;
      text = trailing[1].trim();
    }
  }

  const prompt = text.trim();
  return { prompt: DM_WORD.test(prompt) ? "" : prompt, language, shouldDM };
}

function extensionFor(name) {
  const key = String(name || "").toLowerCase().trim();
  if (!key) return null;
  if (LANGUAGE_EXTENSIONS[key]) return LANGUAGE_EXTENSIONS[key];
  const compact = key.replace(/[\s._-]/g, "");
  if (LANGUAGE_EXTENSIONS[compact]) return LANGUAGE_EXTENSIONS[compact];
  return /^[a-z0-9]{1,12}$/.test(compact) ? compact : null;
}

/**
 * Best-effort language detection from the code itself, used when the model
 * forgot the LANG marker and no language was requested.
 */
function detectLanguage(code) {
  const head = code.slice(0, 4000);
  if (/^#!/.test(head) && /python/.test(head.split("\n")[0])) return "python";
  if (/<\?php/.test(head)) return "php";
  if (/<!doctype html|<html[\s>]/i.test(head)) return "html";
  if (/^\s*package\s+main\b/m.test(head) && /\bfunc\s/.test(head)) return "go";
  if (/\bfn\s+main\b/.test(head) && /\blet\s+mut\b|println!/.test(head)) return "rust";
  if (/\bpublic\s+static\s+void\s+main\b|\bSystem\.out\.print/.test(head)) return "java";
  if (/^\s*using\s+System;/m.test(head)) return "csharp";
  if (/#include\s*<iostream>|std::/.test(head)) return "cpp";
  if (/#include\s*<\w+\.h>|printf\(/.test(head)) return "c";
  if (/(const|function|import)/.test(head) && /:\s*(string|number|boolean)\b|interface\s+\w+\s*\{/.test(head)) return "typescript";
  if (/\bconsole\.log\(|\bfunction\s+\w*\s*\(|=>|require\(/.test(head)) return "javascript";
  if (/\bdef\s+\w+\s*\(|\bfrom\s+\w+\s+import\b|\bimport\s+\w+\s*$|print\(/m.test(head)) return "python";
  if (/\bselect\b[\s\S]*\bfrom\b/i.test(head)) return "sql";
  if (/\bsub\s+\w+|\bmy\s+\$\w+/.test(head)) return "perl";
  return null;
}

/**
 * Turn the model's reply into a deliverable file: strip markdown fences and
 * the LANG marker line, then resolve the file extension from the marker, the
 * requested language, fence info or code heuristics.
 */
export function buildCodeFile(raw) {
  let text = (raw || "").trim();
  if (!text) throw new Error("the model returned no code");

  // unwrap markdown fences if the model ignored the "no fences" rule
  let fencedLanguage;
  const blocks = [...text.matchAll(/```[ \t]*([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g)];
  if (blocks.length) {
    fencedLanguage = blocks.map((block) => block[1].trim()).find(Boolean);
    text = blocks.map((block) => block[2].replace(/\n$/, "")).join("\n\n").trim();
  }

  // the model marks the language on its own first line ("LANG: python")
  let markerLanguage;
  const marker = text.match(/^LANG[ \t]*:[ \t]*([^\n]+)$/im);
  if (marker && marker.index === 0) {
    markerLanguage = marker[1].trim();
    text = text.slice(marker[0].length).replace(/^[ \t]*\r?\n/, "").trimEnd();
  }

  const language = (markerLanguage || fencedLanguage || detectLanguage(text) || "")
    .trim().split(/[\s,]+/)[0].toLowerCase();
  const extension = extensionFor(language) || "txt";
  return {
    buffer: Buffer.from(text, "utf8"),
    language: language || "text",
    extension,
    lines: text.split("\n").length,
  };
}

async function generateCode(prompt, language) {
  const cfg = loadConfig();
  const chain = cfg.ai?.provider_chain?.length
    ? cfg.ai.provider_chain
    : [cfg.ai?.default_provider || "openai"];
  const userContent = language ? `${prompt}\n\n(target language: ${language})` : prompt;
  const { text } = await AIManager.chainGenerateWithHistory([
    { role: "system", content: CODING_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ], chain, { timeoutMs: GENERATION_TIMEOUT_MS });
  return buildCodeFile(text);
}

/**
 * Send the file to the DMs when requested (falling back to the channel when
 * the recipient's DMs are closed), otherwise straight to the channel.
 */
async function deliverCode(message, code, shouldDM) {
  const filename = `code.${code.extension}`;
  const caption = `\`${filename}\` — ${code.language}, ${code.lines} line${code.lines === 1 ? "" : "s"}`;
  const payload = () => ({
    content: caption,
    files: [{ attachment: code.buffer, name: filename }],
    allowedMentions: NO_MENTIONS,
  });

  if (shouldDM) {
    try {
      await message.author.send(payload());
      if (message.guild) {
        await message.channel.send({ content: "📬 sent the code to your dms", allowedMentions: NO_MENTIONS }).catch(() => {});
      }
      return;
    } catch (error) {
      log(`!code DM delivery failed — ${error.message}`, "debug");
      await message.channel.send({ ...payload(), content: `${caption}\n(dms are closed, so here it is instead)` }).catch(() => {});
      return;
    }
  }
  await message.channel.send(payload()).catch(() => {});
}

/**
 * Handle the !code command. Returns true when the message was !code
 * (consumed), so the chat pipeline never sees it.
 */
export async function handleCodeCommand(message) {
  const match = (message.content || "").trim().match(/^!code(?:\s+([\s\S]*))?$/i);
  if (!match) return false;

  const send = (payload) => message.channel.send({ ...payload, allowedMentions: NO_MENTIONS }).catch(() => {});
  const { prompt, language, shouldDM } = parseArgs(match[1] || "");
  if (!prompt) {
    await send({ content: "usage: `!code <prompt> [--lang python] [--dm]` — e.g. `!code python a snake game dm`" });
    return true;
  }

  const userId = message.author.id;
  if (active.has(userId) || active.size >= MAX_ACTIVE) {
    await send({ content: "code generation is busy, try again in a bit" });
    return true;
  }
  active.add(userId);

  let status = null;
  try {
    status = await send({ content: "💻 writing the code, one sec" });
    const code = await generateCode(prompt, language);
    await deliverCode(message, code, shouldDM);
    if (status) status.delete().catch(() => {});
    log(`!code delivered code.${code.extension} (${code.lines} lines) for ${message.author.username}${shouldDM ? " via dm" : ""}`, "debug");
  } catch (error) {
    log(`!code failed — ${error.message}`, "warn");
    const note = "couldn't generate the code — try again in a bit";
    if (status) await status.edit(note).catch(() => {});
    else await send({ content: note });
  } finally {
    active.delete(userId);
  }
  return true;
}
