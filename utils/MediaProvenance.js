import { isImageAttachment } from "./ChatImages.js";
import { isVideoAttachment } from "./ChatVideo.js";

const DELIVERY_LABEL = /^\*\*(Image|Video) model:\*\* `([\w./:-]{1,150})`(?:\r?\n|$)/;
const HOSTED_DELIVERY = /^(?:Download on Catbox|Temporary download \(expires in 1 hour\)): <https:\/\/(?:(?:files|litter)\.catbox\.moe\/[\w.-]+|tmpfiles\.org\/\d+\/[^<>\s]+)>$/m;
const LAST_MEDIA_MS = 60 * 60_000;

function hasMedia(message) {
  return [...(message.attachments?.values() || [])].some(file => isImageAttachment(file) || isVideoAttachment(file));
}

export function generatedMediaLabel(message, botId) {
  if (!botId || message.author?.id !== botId || message.webhookId) return null;
  const content = message.content || "";
  const match = content.match(DELIVERY_LABEL);
  if (!match) return null;
  const kind = match[1].toLowerCase();
  const matchesType = kind === "image" ? isImageAttachment : isVideoAttachment;
  if (![...(message.attachments?.values() || [])].some(matchesType) && !HOSTED_DELIVERY.test(content)) return null;
  return { kind, model: match[2] === "unknown" ? null : match[2] };
}

export function mediaProvenanceReply(messages, references, botId) {
  const text = messages.map(message => message.content || "").join(" ").replace(/\s+/g, " ");
  const asksModel = /\b(?:what|which)\s+(?:(?:ai|image|video|generation)\s+)?(?:model|ai|generator)\b/i.test(text) &&
    !/\b(?:should|would|could)\s+(?:i|we|you)\s+(?:use|try|recommend)\b/i.test(text);
  const asksGenerated = /\b(?:is|was|are|were)\b.{0,40}\b(?:ai[- ]generated|(?:made|generated) (?:by|with|using) ai)\b|\bdid you (?:make|generate) (?:this|that|it)\b/i.test(text);
  if (!asksModel && !asksGenerated) return null;

  const target = messages.at(-1);
  const direct = messages.filter(hasMedia);
  const quoted = references.filter(message => hasMedia(message) || generatedMediaLabel(message, botId));
  // A fresh upload always takes precedence over earlier media. Never use a
  // recent bot post as evidence about a missing quote or an outside URL.
  let candidates = direct.length ? direct : quoted;
  if (!candidates.length && !messages.some(message => message.reference?.messageId) && !/https?:\/\//i.test(text) &&
      /\b(?:you (?:used|use|generate[d]?|made|make)|your (?:last|latest|previous) (?:image|video))\b/i.test(text)) {
    const kind = text.match(/\byour (?:last|latest|previous) (image|video)\b/i)?.[1].toLowerCase();
    const cutoff = target.createdTimestamp - LAST_MEDIA_MS;
    const latest = [...(target.channel.messages?.cache?.values() || [])]
      .filter(message => message.createdTimestamp >= cutoff && message.createdTimestamp <= target.createdTimestamp)
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
      .find(message => {
        const provenance = generatedMediaLabel(message, botId);
        return provenance && (!kind || provenance.kind === kind);
      });
    if (latest) candidates = [latest];
  }

  if (!candidates.length) {
    if (messages.some(message => message.reference?.messageId) || /https?:\/\//i.test(text)) {
      return "i can’t verify whether that was AI-generated or which model made it without a trusted source.";
    }
    return null;
  }
  return [...new Set(candidates.map(message => {
    const info = generatedMediaLabel(message, botId);
    if (!info) return "i can’t verify whether that upload was AI-generated or which model made it from the file alone.";
    return info.model
      ? `yep, i generated that ${info.kind}. the delivery lists \`${info.model}\` as the model.`
      : `yep, i generated that ${info.kind}, but the delivery doesn’t identify the model.`;
  }))].join("\n");
}
