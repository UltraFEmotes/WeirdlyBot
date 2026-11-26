/**
 * ENGAGEMENT MANAGER
 *
 * Tracks whether the bot is currently "in a conversation" with a user in a
 * channel. Engagement starts when someone clearly addresses the bot (ping,
 * reply to it, or a message the relevance judge considers aimed at it), keeps
 * going while their messages stay on-topic, and ends the moment they drift
 * away — after which the bot stays quiet until they address it again.
 */

const engagements = new Map(); // "userId:channelId" -> expiresAt (epoch ms)

let ttlMs = 10 * 60_000;

const keyOf = (userId, channelId) => `${userId}:${channelId}`;

/**
 * Configure how long engagement lingers after the last on-topic message.
 * @param {number} minutes
 */
export function configure(minutes) {
  ttlMs = Math.max(1, Number(minutes) || 10) * 60_000;
}

/**
 * Whether the bot is currently in a conversation with this user here.
 */
export function isEngaged(userId, channelId) {
  const key = keyOf(userId, channelId);
  const expiresAt = engagements.get(key);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    engagements.delete(key);
    return false;
  }
  return true;
}

/**
 * (Re)start / refresh engagement — call when a message keeps the bot in the chat.
 */
export function engage(userId, channelId) {
  engagements.set(keyOf(userId, channelId), Date.now() + ttlMs);
}

/**
 * Leave the conversation — the bot goes quiet until they address it again.
 */
export function disengage(userId, channelId) {
  engagements.delete(keyOf(userId, channelId));
}

// Periodic cleanup of expired engagements
setInterval(() => {
  const now = Date.now();
  for (const [key, expiresAt] of engagements) {
    if (now > expiresAt) engagements.delete(key);
  }
}, 60_000);
