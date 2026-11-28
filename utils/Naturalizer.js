/**
 * NATURALIZER
 *
 * Cleans the patterns that make a chat reply read like an assistant wrote it
 * (em dashes, "great question", "i hope this helps", markdown lists, a
 * question tacked on every time), and remembers the bot's recent openers and
 * phrases per channel so it can be told not to repeat itself.
 */

const RECENT_PER_CHANNEL = 12;
const recent = new Map(); // channelId -> [{ text, at }]

// Whole sentences that are pure assistant filler.
const FILLER_SENTENCES = [
  /\b(?:i hope (?:this|that) helps|hope (?:this|that) helps)\b[^.!?\n]*[.!?]?/gi,
  /\b(?:let me know if (?:you (?:have|need)|there(?:'s| is))[^.!?\n]*)[.!?]?/gi,
  /\bfeel free to [^.!?\n]*[.!?]?/gi,
  /\b(?:is there anything else|anything else (?:i can|you(?:'d| would) like))[^.!?\n]*[.!?]?/gi,
  /\bas an ai(?: language model)?,?\s*/gi,
];
// Openers that only an assistant uses.
const ASSISTANT_OPENERS = /^(?:(?:great|good|excellent|interesting) question[!.,]*|certainly[!.,]*|absolutely[!.,]+|of course[!.,]+|sure thing[!.,]+|i(?:'d| would) be (?:happy|glad) to(?: help)?[!.,]*|happy to help[!.,]*|what a (?:great|fun) [^.!?]{1,30}[!.]*)\s*/i;
// Common casual openers worth rotating.
const CASUAL_OPENERS = /^(?:lol|lmao|lmfao|ngl|tbh|honestly|fr|bro|bruh|yeah|yea|ok(?:ay)?|oh|ah|wait|nah|damn|dude)\b[,!.]*\s+/i;

function words(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []);
}

export function opener(text) {
  return words(text).slice(0, 2).join(" ");
}

function protectedSpans(text, fn) {
  // Never touch code, links, mentions or custom emoji.
  const keep = [];
  const masked = text.replace(/```[\s\S]*?```|`[^`\n]+`|<a?:\w+:\d+>|<[@#][!&]?\d+>|https?:\/\/\S+/g, (match) => {
    keep.push(match);
    return `\u0000${keep.length - 1}\u0000`;
  });
  return fn(masked).replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
}

/**
 * Rewrite one reply segment. `lowercase` follows the persona's typing style.
 */
export function naturalize(text, { lowercase = true } = {}) {
  if (!text) return text;
  return protectedSpans(text, (value) => {
    let out = value;
    for (const pattern of FILLER_SENTENCES) out = out.replace(pattern, "");
    out = out.replace(ASSISTANT_OPENERS, "");
    // Em/en dashes are the most recognisable model tell in casual chat.
    out = out.replace(/\s*[—–]\s*/g, (match, offset, all) => /\d$/.test(all.slice(0, offset)) ? "-" : ", ");
    // Markdown structure doesn't belong in a chat message.
    out = out.replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
      .replace(/\n{2,}/g, "\n");
    // Curly quotes and the ellipsis character read as typeset, not typed.
    out = out.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'").replace(/…/g, "...");
    // Capitalised words only: acronyms (GTA, NASA) and CamelCase stay as typed.
    if (lowercase) out = out.replace(/\b([A-Z])([a-z']*)\b/g, (_, first, rest) => first.toLowerCase() + rest);
    return out.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").replace(/^[,.\s]+/, "").trim();
  });
}

/**
 * Apply naturalize to every segment, then avoid repeating the bot's own
 * recent patterns in this channel: drop a casual opener used twice lately,
 * and drop a trailing question when the last few replies all ended in one.
 */
export function naturalizeReply(segments, channelId, options = {}) {
  const past = recent.get(channelId) || [];
  const lastFive = past.slice(-5);
  let out = segments.map(segment => naturalize(segment, options)).filter(Boolean);
  if (!out.length) return out;

  const first = out[0].match(CASUAL_OPENERS)?.[0];
  if (first && lastFive.filter(item => opener(item.text).startsWith(words(first)[0])).length >= 2) {
    out[0] = out[0].slice(first.length).trim() || out[0];
  }

  const endsWithQuestion = text => /\?\s*$/.test(text);
  const last = out.at(-1);
  if (endsWithQuestion(last) && lastFive.length >= 3 && lastFive.slice(-3).every(item => endsWithQuestion(item.text))) {
    const sentences = last.split(/(?<=[.!?])\s+/);
    if (sentences.length > 1) out[out.length - 1] = sentences.slice(0, -1).join(" ");
  }
  return out.filter(Boolean);
}

export function rememberReply(channelId, text) {
  if (!channelId || !text) return;
  const list = recent.get(channelId) || [];
  list.push({ text, at: Date.now() });
  recent.set(channelId, list.slice(-RECENT_PER_CHANNEL));
}

/**
 * A prompt line listing the bot's own recent openers and phrases here, so
 * the model varies them.
 */
export function repetitionHint(channelId) {
  const past = (recent.get(channelId) || []).filter(item => Date.now() - item.at < 6 * 3_600_000).slice(-6);
  if (past.length < 2) return "";
  const openers = [...new Set(past.map(item => opener(item.text)).filter(Boolean))];
  const emoji = [...new Set(past.flatMap(item => item.text.match(/\p{Extended_Pictographic}/gu) || []))];
  return `your last messages here started with: ${openers.map(o => `"${o}"`).join(", ")}${emoji.length ? `; emoji you used: ${emoji.join(" ")}` : ""}. start differently and don't reuse the same emoji or catchphrase.`;
}

/**
 * Turn :name: into the server's custom emoji the account can actually use.
 * Selfbots without Nitro can only send non-animated emoji from this server.
 */
export function applyCustomEmoji(text, guild, { allowAnimated = false } = {}) {
  if (!guild?.emojis?.cache?.size || !text) return text;
  return text.replace(/(^|[^<\w]):([\w~]{2,32}):(?!\d)/g, (match, before, name) => {
    const emoji = [...guild.emojis.cache.values()].find(item => item.name?.toLowerCase() === name.toLowerCase() &&
      item.available !== false && (allowAnimated || !item.animated));
    return emoji ? `${before}<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>` : match;
  });
}

/** Names of usable custom emoji in this server, for the prompt. */
export function customEmojiNames(guild, { allowAnimated = false, limit = 30 } = {}) {
  if (!guild?.emojis?.cache?.size) return [];
  return [...guild.emojis.cache.values()]
    .filter(item => item.name && item.available !== false && (allowAnimated || !item.animated))
    .slice(0, limit).map(item => item.name);
}
