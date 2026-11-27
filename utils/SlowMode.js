/**
 * SLOWMODE PACING
 *
 * Discord slowmode limits a channel to one message per rateLimitPerUser
 * seconds — and that applies to the account behind the bot too. Bursting
 * through it spams Discord with 429 retries (bad news for a selfbot) and
 * looks robotic, so every send in a slowmode channel goes through a pacing
 * queue: it waits out the remaining cooldown like a person would, adds a
 * little human jitter, then takes the slot.
 *
 * Manual messages the owner sends on the same account count too — they are
 * picked up in messageCreate and noted here before the pipeline ignores them.
 */

import { wait, log } from "./functions.js";
import { rand } from "./Humanizer.js";

const lastSend = new Map(); // channelId -> timestamp of our last reserved send
const MAX_WAIT_MS = 10 * 60_000; // never block the reply pipeline longer than this

/**
 * The channel's slowmode in seconds (0 = none, DMs included).
 */
export function slowmodeSeconds(channel) {
  const value = Number(channel?.rateLimitPerUser);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Note that a message was already sent in this channel (by the bot pipeline
 * or manually by the account owner), so the next paced send waits for it.
 */
export function noteSend(channel, at = Date.now()) {
  if (channel?.id && slowmodeSeconds(channel) > 0) lastSend.set(channel.id, at);
}

/**
 * Wait for the next free slot in a slowmode channel, reserve it and send.
 * Resolves with the callback's return value. Channels without slowmode (and
 * DMs) pass straight through. Throws when the cooldown is unreasonably long —
 * a person simply wouldn't reply in a channel that throttles for hours.
 */
export async function pacedSend(channel, send) {
  const slow = slowmodeSeconds(channel);
  if (!channel?.id || slow <= 0) return send();

  let waitMs = (lastSend.get(channel.id) || 0) + slow * 1000 - Date.now();
  if (waitMs > MAX_WAIT_MS) {
    log(`slowmode cooldown of ${Math.round(waitMs / 1000)}s in #${channel.name || channel.id} is too long — skipping this send`, "warn");
    throw new Error("slowmode cooldown too long");
  }
  if (waitMs > 10_000) {
    log(`waiting ${Math.round(waitMs / 1000)}s for a free slot in #${channel.name || channel.id} (slowmode ${slow}s)`, "debug");
  }
  if (waitMs > 0) await wait(waitMs + rand(150, 900));

  lastSend.set(channel.id, Date.now());
  return send();
}

// the map only needs recent timestamps — stale entries are dead weight
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60_000;
  for (const [id, at] of lastSend) if (at < cutoff) lastSend.delete(id);
}, 10 * 60_000);
