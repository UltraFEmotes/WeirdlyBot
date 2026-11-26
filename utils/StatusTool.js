const REQUEST_PREFIX = /^(?:hey[,! ]+)?(?:(?:can|could|would|will) (?:you|u)\s+|(?:please|pls|plz)\s+)*(?:change|set|update|make)\s+(?:your|ur|the)\s+(?:custom\s+)?status\b/i;
const INDIRECT_REQUEST = /^(?:(?:can|could) (?:your|ur) (?:custom )?status say|i (?:want|would like) (?:your|ur) (?:custom )?status to (?:say|be))\s+([\s\S]+)$/i;
const QUOTED_STATUS = /^(?:"([^"]*)"|'([^']*)'|`([^`]*)`|“([^”]*)”)[.!?]?$/;
const MAX_STATUS_LENGTH = 128;
const STATUS_COOLDOWN_MS = 15_000;
const lastStatusUpdate = new WeakMap();

function unquoteStatus(text) {
  return text.match(QUOTED_STATUS)?.slice(1).find((part) => part !== undefined)?.trim();
}

export function parseStatusRequest(content, allowIndirect = false) {
  const input = content.trim();
  const prefix = input.match(REQUEST_PREFIX);
  const value = (prefix
    ? input.slice(prefix[0].length).match(/^(?:\s+(?:to|say)\b\s*|\s*:\s*)([\s\S]+)$/i)?.[1]
    : allowIndirect ? input.match(INDIRECT_REQUEST)?.[1] : null)?.trim();
  if (!value) return null;
  return (unquoteStatus(value) ?? value) || null;
}

export function isIncompleteStatusRequest(content) {
  const input = content.trim();
  const prefix = input.match(REQUEST_PREFIX);
  return Boolean(prefix && /^(?:\s+(?:to|say))?\s*[?:.!]?$/.test(input.slice(prefix[0].length).toLowerCase()));
}

export function parseStatusFollowup(content, repliedToPrompt) {
  const input = content.trim();
  return (unquoteStatus(input) ?? (repliedToPrompt ? input : "")) || null;
}

// The model handles intent and phrasing; the actual text must come from this
// turn's messages, not from the model or older conversation history.
export function findStatusToolText(toolValue, inputs) {
  const value = toolValue.trim();
  const text = unquoteStatus(value) ?? value;
  if (!text) return null;

  const literal = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
  for (const input of [...inputs].reverse()) {
    const match = input.match(literal);
    if (match) return match[0];
  }
  return null;
}

export function setCustomStatus(client, text) {
  if (text.length > MAX_STATUS_LENGTH || /[\r\n]/.test(text)) {
    return "Status text needs to fit on one line and be at most 128 characters.";
  }
  const now = Date.now();
  const previous = lastStatusUpdate.get(client);
  if (previous !== undefined && now - previous < STATUS_COOLDOWN_MS) {
    return "The status just changed. Give it a few seconds before trying again.";
  }
  client.user.setActivity({ name: "Custom Status", type: client.config?.mode === "bot" ? 4 : "CUSTOM", state: text });
  lastStatusUpdate.set(client, now);
  return "Updated my custom status.";
}
