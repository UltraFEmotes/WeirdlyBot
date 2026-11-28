import { hasChatImage, imageSources } from "./ChatImages.js";
import { generatedMediaLabel } from "./MediaProvenance.js";

const REPLACEMENT = /^\s*(?:(?:<@!?\d+>|\p{L}[\p{L}\p{N}_-]*[,!:])\s*)?(?:please\s+)?(?:can you\s+|could you\s+)?(?:change|replace|swap)\s+\S.{0,180}?\b(?:to|with|for|into)\s+\S/iu;
const RESIZE = /\b(?:crop|uncrop|reframe|outpaint|expand (?:the )?canvas|aspect ratio|(?:make|convert|resize|change)\b.{0,30}\b(?:portrait|landscape|square|widescreen|\d{1,2}:\d{1,2}))\b/i;
const RECENT_IMAGE = /\b(?:your|that|this|the|last|latest|previous)\s+(?:(?:last|latest|previous|generated|new|same)\s+)?(?:image|pic(?:ture)?|photo|drawing|render|one)\b|\b(?:make|turn|change|edit|redo|fix)\s+it\b/i;
const RECENT_MS = 60 * 60_000;
const ASPECTS = ["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "21:9"];

export function isImageReplacement(text) {
  return REPLACEMENT.test(text || "");
}

export function refersToRecentImage(messages) {
  return messages.some(message => RECENT_IMAGE.test(message.content || ""));
}

// The bot's own latest generated image in this channel, so "make it blue"
// works without replying to the result.
function recentGeneratedImage(target, botId) {
  if (!target?.channel || !botId) return null;
  const cutoff = target.createdTimestamp - RECENT_MS;
  return [...(target.channel.messages?.cache?.values() || [])]
    .filter(message => message.createdTimestamp >= cutoff && message.createdTimestamp <= target.createdTimestamp)
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
    .find(message => generatedMediaLabel(message, botId)?.kind === "image" && hasChatImage(message)) || null;
}

export function imageEditSources(messages, references, request, { botId, allowRecent = false } = {}) {
  if (request && hasChatImage(request)) return [request];
  if (request?.reference?.messageId) {
    const quoted = references.find(ref => ref.id === request.reference.messageId && hasChatImage(ref));
    return quoted ? [quoted] : [];
  }
  const newestFirst = [...messages].reverse();
  const direct = newestFirst.find(hasChatImage);
  if (direct) return [direct];
  for (const message of newestFirst) {
    const source = references.find(ref => ref.id === message.reference?.messageId && hasChatImage(ref));
    if (source) return [source];
  }
  const recent = allowRecent && !newestFirst.some(message => message.reference?.messageId)
    ? recentGeneratedImage(newestFirst[0], botId) : null;
  return recent ? [recent] : [];
}

/**
 * The images to use from the edit source messages, in the order they appear.
 * `picks` are 1-based numbers the model chose ("the second one" → [2]); with
 * none, a message with several images uses only the first, so the generator
 * never has to guess which one to edit or blend them all together.
 */
export function pickEditImages(messages, picks = []) {
  const seen = new Set();
  const all = messages.flatMap(imageSources).filter(source => !seen.has(source.url) && seen.add(source.url));
  if (picks === "all") return all.slice(0, 4);
  const chosen = [...new Set(picks)].map(n => all[n - 1]).filter(Boolean);
  return chosen.length ? chosen.slice(0, 4) : all.slice(0, 1);
}

/** Parse "2", "1,3", "1 and 3" or "all" from a `source=` option. */
export function parseSourcePicks(value) {
  const text = String(value || "").trim().toLowerCase();
  if (/^(?:all|every|both)\b/.test(text)) return "all";
  return [...text.matchAll(/\d{1,2}/g)].map(match => Number(match[0])).filter(n => n >= 1 && n <= 10);
}

export function imageEditInstructions(prompt, sources) {
  const requestedReframe = RESIZE.test(prompt);
  const framing = requestedReframe ? "Change the framing only as requested." :
    "Keep the original aspect ratio, framing, camera angle, composition, pose, and background.";
  const several = sources.length > 1;
  const instruction = [
    several ? `Use the ${sources.length} attached source images together to make one edited image.` :
    "Edit the attached source image in place. It is the image to modify, not just inspiration for a new image.",
    `Requested edit: ${prompt}`,
    "Preserve the original subject’s recognizable identity, face, colors, lighting, and visual style except where the requested edit explicitly changes them.",
    "For an object replacement, change only that object and the minimum surrounding pixels needed to fit it. Do not redraw the rest of the scene.",
    framing,
  ].join("\n");
  // Sources are picked image sources; a whole message is accepted too.
  const primary = sources[0]?.url ? sources[0] : sources[0] && imageSources(sources[0])[0];
  if (requestedReframe || !(primary?.width > 0 && primary?.height > 0)) return { instruction };
  const ratio = primary.width / primary.height;
  const distance = aspect => {
    const [w, h] = aspect.split(":").map(Number);
    return Math.abs(Math.log(ratio / (w / h)));
  };
  const size = ASPECTS.reduce((best, aspect) => distance(aspect) < distance(best) ? aspect : best);
  return { instruction, size };
}
