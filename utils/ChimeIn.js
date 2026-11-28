/**
 * CHIME IN
 *
 * When the account has been quiet in a whitelisted server for a while — or
 * has never said anything there — it chimes in once the next time people are
 * chatting, like a person who's been lurking. It waits for a lively channel,
 * lurks a bit, checks when it last spoke there (Discord search, in case the
 * account posted while the bot was off), then sends one casual line that fits
 * the conversation. Speaking resets the clock, so it doesn't happen again
 * until the server has gone quiet for the bot again.
 */

const ACTIVE_WINDOW_MS = 10 * 60_000;
const MIN_RECENT = 3;
const LURK_MIN_MS = 45_000;
const LURK_MAX_MS = 3 * 60_000;
const RETRY_MS = 30 * 60_000;

/**
 * @param {object} deps
 * @param {(guildId: string) => number|null} deps.lastSpokeAt - stored time the account last spoke there
 * @param {(guildId: string, at: number) => void} deps.noteSpoke
 * @param {(channel, botId: string) => Promise<number|null>} deps.searchLastSpoke - 0 = never, null = unknown
 * @param {() => number} deps.quietMs - how long without speaking before chiming in
 * @param {(context: object) => Promise<string>} deps.generate - the line to send, or "" to skip
 * @param {(channel, text: string) => Promise<void>} deps.post
 */
export function createChimeIns({ lastSpokeAt, noteSpoke, searchLastSpoke, quietMs, generate, post, log = () => {},
  now = Date.now, random = Math.random, wait = ms => new Promise(resolve => setTimeout(resolve, ms).unref?.()) }) {
  const busy = new Set();
  const retryAfter = new Map();

  function recentChat(channel, botId) {
    const cutoff = now() - ACTIVE_WINDOW_MS;
    return [...(channel.messages?.cache?.values() || [])]
      .filter(message => message.author && !message.author.bot && message.author.id !== botId &&
        !message.system && !message.webhookId && message.content?.trim() && !/^\s*[!/]/.test(message.content) &&
        message.createdTimestamp >= cutoff)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  }

  const quiet = (at) => at === null || now() - at >= quietMs();

  /** Every human message in a whitelisted server; chimes in when the bot's been quiet and the room is lively. */
  async function noteMessage(message) {
    const guild = message.guild;
    const botId = message.client?.user?.id;
    if (!guild || !botId || message.client.user.bot || busy.has(guild.id) || !(quietMs() > 0)) return;
    if ((retryAfter.get(guild.id) || 0) > now() || !quiet(lastSpokeAt(guild.id))) return;
    const channel = message.channel;
    if (!channel.permissionsFor?.(botId)?.has?.(["VIEW_CHANNEL", "SEND_MESSAGES"])) return;
    const recent = recentChat(channel, botId);
    if (recent.length < MIN_RECENT || new Set(recent.map(m => m.author.id)).size < 2) return;

    busy.add(guild.id);
    try {
      await wait(LURK_MIN_MS + random() * (LURK_MAX_MS - LURK_MIN_MS));
      if (!quiet(lastSpokeAt(guild.id))) return; // it got talked to while lurking
      const searched = await searchLastSpoke(channel, botId);
      if (searched === null) {
        retryAfter.set(guild.id, now() + RETRY_MS);
        return;
      }
      if (searched > 0) noteSpoke(guild.id, searched);
      if (searched > 0 && !quiet(searched)) return;
      const chat = recentChat(channel, botId).slice(-12);
      if (chat.length < 2) return; // the room went quiet while lurking
      const text = (await generate({
        firstTime: searched === 0,
        server: guild.name,
        channel: channel.name,
        messages: chat.map(m => ({ author: m.member?.displayName || m.author.globalName || m.author.username, text: m.content.slice(0, 300) })),
      }) || "").trim();
      if (!text) {
        retryAfter.set(guild.id, now() + RETRY_MS);
        return;
      }
      await post(channel, text);
      noteSpoke(guild.id, now());
      log(`chimed in on "${guild.name}" #${channel.name}${searched === 0 ? " (first message there)" : ""}`);
    } catch (error) {
      retryAfter.set(guild.id, now() + RETRY_MS);
      log(`chime-in skipped in "${guild.name}" — ${error.message}`);
    } finally {
      busy.delete(guild.id);
    }
  }

  return { noteMessage };
}

/** When the account last posted anywhere in this channel's server (Discord search): 0 = never, null = unknown. */
export async function searchLastSpoke(channel, botId) {
  try {
    const result = await channel.messages.search({ authors: [botId], limit: 1 });
    return result.messages.first()?.createdTimestamp || (result.total > 0 ? null : 0);
  } catch {
    return null; // search index not ready, no permission, rate limited...
  }
}
