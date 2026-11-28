/**
 * CHANNEL VIBE
 *
 * Cheap, model-free context that helps the bot fit in: how people in this
 * channel actually type (length, caps, emoji, slang), who is active right
 * now, the local time, and a mood that drifts from day to day.
 */

const SLANG = ["lol", "lmao", "lmfao", "fr", "ngl", "tbh", "idk", "bro", "bruh", "deadass", "ong", "w", "l", "ratio",
  "based", "cap", "bet", "lowkey", "highkey", "ikr", "smh", "wtf", "omg", "rn", "imo", "mid", "goated", "slay", "yall", "innit", "mate"];
const MOODS = [
  "chill and easygoing", "a bit hyper and goofy", "kinda sleepy and low-effort", "in a teasing mood",
  "curious and chatty", "dry and sarcastic (playfully)", "in a good mood", "a little distracted but friendly",
];

function humanMessages(channel, botId, limit = 40) {
  return [...(channel.messages?.cache?.values() || [])]
    .filter(m => m.author && !m.author.bot && m.author.id !== botId && !m.system && m.content)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .slice(-limit);
}

/**
 * Describe how people type in this channel, e.g. "short messages (~6 words),
 * mostly lowercase, light emoji, slang like lol, fr, ngl".
 */
export function channelStyle(channel, botId) {
  const messages = humanMessages(channel, botId);
  if (messages.length < 6) return "";
  const texts = messages.map(m => m.content.replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>|https?:\/\/\S+/g, "").trim()).filter(Boolean);
  if (!texts.length) return "";
  const wordCounts = texts.map(t => t.split(/\s+/).filter(Boolean).length).sort((a, b) => a - b);
  const median = wordCounts[Math.floor(wordCounts.length / 2)];
  const lettered = texts.filter(t => /[a-z]/i.test(t));
  const lower = lettered.filter(t => t === t.toLowerCase()).length / Math.max(1, lettered.length);
  const emoji = messages.filter(m => /\p{Extended_Pictographic}|<a?:\w+:\d+>/u.test(m.content)).length / messages.length;
  const counts = new Map();
  for (const word of texts.join(" ").toLowerCase().match(/[a-z']+/g) || []) {
    if (SLANG.includes(word)) counts.set(word, (counts.get(word) || 0) + 1);
  }
  const slang = [...counts].sort((a, b) => b[1] - a[1]).filter(([, n]) => n >= 2).slice(0, 5).map(([w]) => w);
  const parts = [
    median <= 4 ? `very short messages (~${median} words)` : median <= 10 ? `short messages (~${median} words)` : `longer messages (~${median} words)`,
    lower > 0.75 ? "mostly lowercase" : lower < 0.35 ? "normal capitalisation" : "mixed capitalisation",
    emoji > 0.35 ? "lots of emoji" : emoji > 0.1 ? "some emoji" : "barely any emoji",
  ];
  if (slang.length) parts.push(`slang like ${slang.join(", ")}`);
  return `how people type in this channel: ${parts.join(", ")}. blend in with that instead of overdoing slang.`;
}

/** Display names of people who spoke here in the last 15 minutes. */
export function activePeople(channel, botId) {
  const cutoff = Date.now() - 15 * 60_000;
  const names = new Map();
  for (const m of humanMessages(channel, botId, 60)) {
    if (m.createdTimestamp >= cutoff) names.set(m.author.id, m.member?.displayName || m.author.globalName || m.author.username);
  }
  return [...names.values()].slice(-8);
}

function hash(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

/**
 * The bot's local time and today's mood. The mood is stable for a day per
 * server/DM, so it feels consistent but not identical every day.
 */
export function timeAndMood(scope, timeZone) {
  const now = new Date();
  let when;
  try {
    when = now.toLocaleString("en-US", { timeZone: timeZone || undefined, weekday: "long", hour: "numeric", minute: "2-digit" });
  } catch {
    when = now.toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" });
  }
  const day = now.toISOString().slice(0, 10);
  const mood = MOODS[hash(`${scope}|${day}`) % MOODS.length];
  return `it's ${when} for you. today you're ${mood} — let it colour your replies slightly, never announce it.`;
}

/**
 * A hint about reply length based on what they just sent.
 */
export function lengthHint(text) {
  const words = String(text || "").split(/\s+/).filter(Boolean).length;
  if (words <= 3) return "they sent something tiny — answer with a few words, or just a react marker if a reaction says it all.";
  if (words <= 12) return "they sent a short message — keep yours about as short.";
  if (words >= 60) return "they wrote a lot — a fuller reply is fine, but still chat-length, not an essay.";
  return "";
}
