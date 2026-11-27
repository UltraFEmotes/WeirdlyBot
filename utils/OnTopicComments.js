const RECENT_MS = 8 * 60_000;
const COOLDOWN_MS = 4 * 60_000;
const ATTEMPT_MS = 45_000;
const QUIET_MS = 2_000;
const MAX_CHANNELS = 128;

export function createOnTopicComments({ generate, post, now = Date.now, random = Math.random }) {
  const channels = new Map();
  let active = 0;

  function remember(channel, message) {
    if (!message?.content?.trim()) return;
    const prior = channels.get(channel.id);
    channels.delete(channel.id);
    channels.set(channel.id, {
      anchor: { text: message.content.slice(0, 360), at: message.createdTimestamp ?? now(), authorId: message.author?.id },
      activity: prior?.activity ?? 0,
      lastComment: prior?.lastComment ?? -Infinity,
      lastAttempt: prior?.lastAttempt ?? -Infinity,
      typing: prior?.typing ?? new Map(),
    });
    if (channels.size > MAX_CHANNELS) channels.delete(channels.keys().next().value);
  }

  function noteMessage(message) {
    const state = channels.get(message.channel?.id);
    if (!state) return;
    state.activity = now();
    state.typing.delete(message.author.id);
  }

  function noteTyping(user, channel) {
    const state = channels.get(channel?.id);
    if (state && user?.id && !user.bot && now() - state.anchor.at < RECENT_MS) {
      state.typing.set(user.id, now() + 10_000);
      for (const [id, expires] of state.typing) if (expires <= now()) state.typing.delete(id);
    }
  }

  function isQuiet(state) {
    return now() - state.activity >= QUIET_MS && ![...state.typing.values()].some(until => until > now());
  }

  async function consider(target, chance, stillAllowed) {
    if (!target.guild || !chance || active >= 2 || /^\s*[!/]/.test(target.content || "")) return;
    const channel = target.channel;
    const state = channels.get(channel.id);
    if (!state || now() - state.anchor.at >= RECENT_MS || now() - state.lastComment < COOLDOWN_MS ||
        now() - state.lastAttempt < ATTEMPT_MS || !isQuiet(state) || !stillAllowed()) return;

    const recent = [...new Map([...(channel.messages?.cache?.values() || []), target].map(message => [message.id, message])).values()]
      .filter(message => message.createdTimestamp > state.anchor.at && message.author && !message.author.bot &&
        message.author.id !== state.anchor.authorId &&
        !message.system && !message.webhookId && message.content?.trim() && !/^\s*[!/]/.test(message.content))
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp).slice(-8);
    if (recent.at(-1)?.id !== target.id || recent.length < 3 ||
        new Set(recent.map(message => message.author.id)).size < 2 || random() >= chance) return;

    state.lastAttempt = now();
    const startingActivity = state.activity;
    const canPost = () => channels.get(channel.id) === state && state.activity === startingActivity &&
      isQuiet(state) && now() - state.anchor.at < RECENT_MS && stillAllowed();
    active += 1;
    try {
      const text = (await generate({
        previousBotMessage: state.anchor.text,
        recent: recent.map(message => ({
          speaker: message.member?.displayName || message.author.username,
          text: message.content.slice(0, 280),
        })),
      }))?.trim();
      if (!text || /^skip[.!]?$/i.test(text) || text.length > 260 || /\n|\[\[|<@|@(?:everyone|here)\b|https?:\/\//i.test(text) || !canPost()) return;
      const sent = await post(channel, text, canPost);
      if (sent) {
        state.lastComment = now();
        const current = channels.get(channel.id);
        if (current) current.lastComment = state.lastComment;
      }
    } finally {
      active -= 1;
    }
  }

  return { remember, noteMessage, noteTyping, consider };
}
