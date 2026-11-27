import { pacedSend } from "./SlowMode.js";

const REACTIONS = { search: "🌐", image: "🎨", video: "🎬", code: "💻", gif: "🎞️", ocr: "🔎" };
export const NO_TOOL_MENTIONS = { parse: [], repliedUser: false };

export async function reactForTool(target, kind) {
  try { await target.react(REACTIONS[kind]); } catch { /* reactions are optional */ }
}

export function toolCaption(segments) {
  return segments.map(s => s.trim()).filter(s => s &&
    !/^(?:(?:ok(?:ay)?[,.! ]+|sure[,.! ]+)?(?:on it|(?:i(?:'ll|’ll| will| am|'m|’m)\s+)?(?:look(?:ing)?\s+(?:it\s+)?up|search(?:ing)?|mak(?:e|ing)|generat(?:e|ing)|creat(?:e|ing)|edit(?:ing)?|animat(?:e|ing)|writ(?:e|ing))\b|one sec|give me a sec|hang on))/i.test(s)).join("\n").slice(0, 250);
}

export async function toolReply(target, payload, { ping = false, replyTo = target } = {}) {
  const user = target.author.id;
  const mention = ping && target.guild ? `<@${user}> ` : "";
  const message = {
    ...payload,
    content: payload.content?.slice(0, 2000 - mention.length),
    allowedMentions: ping && target.guild ? { ...NO_TOOL_MENTIONS, users: [user] } : NO_TOOL_MENTIONS,
  };
  try {
    // Keep media model labels on the first line so provenance can read them.
    if (mention) message.content = `${message.content || ""}\n${mention.trim()}`.trim();
    return await pacedSend(target.channel, () => replyTo.reply(message));
  } catch {
    return pacedSend(target.channel, () => target.channel.send(message));
  }
}

export async function notifyToolResult(target, result) {
  await toolReply(target, { content: "done — it’s ready above." }, { ping: true, replyTo: result }).catch(() => {});
}
