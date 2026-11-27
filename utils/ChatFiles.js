import axios from "axios";
import { isImageAttachment } from "./ChatImages.js";

const MAX_BYTES = 128 * 1024;
const MAX_CHARS = 4_000;
const MAX_FILES = 4;
const CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const TEXT_EXTENSION = /\.(?:txt|log|md|markdown|rst|csv|tsv|jsonl?|ndjson|ya?ml|toml|xml|ini|cfg|conf|sql|diff|patch|[cm]?[jt]sx?|py|rb|php|java|kt|scala|go|rs|swift|dart|lua[u]?|[ch]|cc|cpp|hpp|cs|sh|bash|zsh|ps1|bat|html?|css|scss|vue|svelte|ipynb)$/i;

export function hasChatFile(message) {
  return [...(message.attachments?.values() || [])].some(file => !isImageAttachment(file));
}

function canRead(file) {
  return /^text\//i.test(file.contentType || "") ||
    /^application\/(?:json|xml|yaml|x-yaml|javascript)(?:;|$)/i.test(file.contentType || "") ||
    TEXT_EXTENSION.test(file.name || "") ||
    /^(?:Dockerfile|Makefile)$/i.test(file.name || "");
}

async function readFile(file, source) {
  const name = (file.name || "attachment").slice(0, 120);
  const result = { name, source };
  if (!canRead(file)) return { ...result, status: "unsupported format" };
  if (file.size > MAX_BYTES) return { ...result, status: "exceeds the 128 KiB limit" };
  try {
    const url = new URL(file.url);
    if (url.protocol !== "https:" || !CDN_HOSTS.has(url.hostname) || url.port ||
        url.username || url.password || !url.pathname.startsWith("/attachments/")) {
      return { ...result, status: "not a Discord attachment URL" };
    }
    const { data } = await axios.get(url.href, {
      responseType: "arraybuffer", timeout: 10_000, maxContentLength: MAX_BYTES, maxRedirects: 0,
    });
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (/[\u0000-\u0008\u000B\u000E-\u001F]/.test(text)) {
      return { ...result, status: "not a UTF-8 text file" };
    }
    return { ...result, text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS };
  } catch {
    return { ...result, status: "could not be read as UTF-8 text" };
  }
}

export async function collectChatFiles(messages, references = []) {
  const seen = new Set();
  const candidates = [];
  let omitted = false;
  for (const [source, group] of [["current message", [...messages].reverse()], ["replied-to message", references]]) {
    for (const message of group) {
      for (const file of message.attachments?.values() || []) {
        if (isImageAttachment(file) || seen.has(file.url)) continue;
        seen.add(file.url);
        if (candidates.length < MAX_FILES) candidates.push(readFile(file, source));
        else omitted = true;
      }
    }
  }
  return { files: await Promise.all(candidates), omitted };
}
