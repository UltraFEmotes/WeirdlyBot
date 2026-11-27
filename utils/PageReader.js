import { safeGet } from "./SafeFetch.js";

const MAX_PAGE_BYTES = 1_500_000;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return point > 0 && point < 0x110000 ? String.fromCodePoint(point) : "";
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * Rough readable-text extraction: drop chrome (scripts, nav, footers, forms),
 * prefer <article>/<main> when present, and keep paragraph breaks.
 */
export function extractText(html) {
  let body = String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|nav|header|footer|aside|form|button|select)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const main = body.match(/<article\b[\s\S]*?<\/article\s*>/gi) || body.match(/<main\b[\s\S]*?<\/main\s*>/i);
  if (main) {
    const joined = main.join("\n");
    if (joined.replace(/<[^>]+>/g, "").trim().length > 400) body = joined;
  }
  const text = decodeEntities(body
    .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|tr|section|blockquote|pre|table|dd|dt)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n");
  // Short lines are usually menus, buttons and share links.
  return text.split("\n").map(line => line.trim())
    .filter(line => line.length >= 40 || (/[.!?:]$/.test(line) && line.length >= 15))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function title(html) {
  return decodeEntities(String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
}

/**
 * Fetch a public page and return up to maxChars of readable text, or null.
 */
export async function readPage(url, { maxChars = 2_500, timeoutMs = 6_000 } = {}) {
  try {
    const { data, contentType } = await safeGet(url, {
      maxBytes: MAX_PAGE_BYTES, timeoutMs, accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
    });
    if (!/^(?:text\/html|application\/xhtml\+xml|text\/plain)\b/i.test(contentType)) return null;
    const raw = data.toString("utf8");
    const text = /^text\/plain/i.test(contentType) ? raw.replace(/\s+\n/g, "\n").trim() : extractText(raw);
    if (text.length < 200) return null;
    return { title: title(raw).slice(0, 180), text: text.slice(0, maxChars), truncated: text.length > maxChars };
  } catch {
    return null;
  }
}
