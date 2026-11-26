/**
 * CONVERSATION STORE
 *
 * In-memory chat history per user+channel so replies have context.
 * History outlives the conversation session (20 min TTL vs 5 min session),
 * so if someone comes back later the bot still remembers the chat.
 */

const histories = new Map(); // key -> { messages: [], lastActivity }

const MAX_MESSAGES = 20;          // keep last 10 user+assistant pairs
const TTL_MS = 20 * 60_000;       // drop history after 20 min of inactivity

/**
 * Get (or create) the history array for a user+channel key.
 */
export function getHistory(key) {
  let entry = histories.get(key);
  if (!entry) {
    entry = { messages: [], lastActivity: Date.now() };
    histories.set(key, entry);
  }
  entry.lastActivity = Date.now();
  return entry.messages;
}

/**
 * Append a user message + assistant reply pair and trim the history.
 */
export function appendPair(key, userContent, assistantContent) {
  if (!userContent && !assistantContent) return;
  const history = getHistory(key);

  if (userContent) history.push({ role: "user", content: userContent });
  if (assistantContent) history.push({ role: "assistant", content: assistantContent });

  if (history.length > MAX_MESSAGES) {
    history.splice(0, history.length - MAX_MESSAGES);
  }
}

/**
 * Forget a single conversation (used on errors that would corrupt context).
 */
export function clearHistory(key) {
  histories.delete(key);
}

// Periodic cleanup of stale histories
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of histories) {
    if (now - entry.lastActivity > TTL_MS) histories.delete(key);
  }
}, 60_000);
