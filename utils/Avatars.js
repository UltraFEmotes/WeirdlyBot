/**
 * AVATARS
 *
 * Profile-picture awareness: who a message @mentions, what their pfp looks
 * like, and using that pfp as a reference when someone asks for an image or
 * video of them ("make @sam as a knight", "animate my pfp", "draw me as a
 * cat"). Avatars are public Discord CDN images, loaded like attachments.
 */

import { readDiscordImage } from "./ChatImages.js";

const MAX_AVATARS = 3;
const PFP_WORDS = /\b(?:pfp|pfps|avatar|avatars|profile\s*pic(?:ture)?s?|icon)\b/i;
// "of me", "me as a knight", "my pfp", "make me into"... but not "make me a cat".
const SELF = /\b(?:of|with|like|featuring)\s+(?:me|myself)\b|\b(?:me|myself)\s+(?:as|into|in a|in an|wearing|riding|holding)\b|\bmy\s+(?:pfp|avatar|profile\s*pic(?:ture)?|face|icon)\b/i;
const BOT_SELF = /\b(?:of|with|like)\s+(?:you|yourself)\b|\b(?:you|yourself)\s+as\b|\byour\s+(?:pfp|avatar|profile\s*pic(?:ture)?|face|icon)\b/i;

export function mentionsAvatar(text) {
  return PFP_WORDS.test(text || "");
}

function displayName(user, member) {
  return member?.displayName || user.globalName || user.username || "someone";
}

function avatarUrl(user, member) {
  const options = { format: "png", dynamic: false, size: 512, extension: "png", forceStatic: true };
  try {
    return member?.displayAvatarURL?.(options) || user.displayAvatarURL?.(options) || null;
  } catch {
    return null;
  }
}

/**
 * The people a set of messages is about, with their avatar URL:
 * @mentioned users, the author when they say "me"/"my pfp", and the bot when
 * they say "you"/"your pfp". Only @mentions count unless `self` phrases appear.
 * @returns {{ id: string, name: string, url: string, self?: boolean, bot?: boolean }[]}
 */
export function avatarSubjects(messages, client) {
  const subjects = new Map();
  const botId = client?.user?.id;
  for (const message of messages) {
    const text = message.content || "";
    for (const user of message.mentions?.users?.values() || []) {
      if (user.id === botId && !BOT_SELF.test(text) && !PFP_WORDS.test(text)) continue;
      const member = message.mentions.members?.get?.(user.id) || message.guild?.members?.cache?.get(user.id);
      const url = avatarUrl(user, member);
      if (url) subjects.set(user.id, { id: user.id, name: displayName(user, member), url, bot: user.id === botId });
    }
    if (SELF.test(text) && message.author) {
      const url = avatarUrl(message.author, message.member);
      if (url) subjects.set(message.author.id, { id: message.author.id, name: displayName(message.author, message.member), url, self: true });
    }
    if (BOT_SELF.test(text) && client?.user) {
      const member = message.guild?.members?.me;
      const url = avatarUrl(client.user, member);
      if (url) subjects.set(client.user.id, { id: client.user.id, name: displayName(client.user, member), url, bot: true });
    }
  }
  return [...subjects.values()].slice(0, MAX_AVATARS);
}

/** Load avatars as data URLs; failed ones are dropped. */
export async function loadAvatars(subjects) {
  const loaded = await Promise.all(subjects.map(async subject => {
    try {
      const image = await readDiscordImage({ url: subject.url });
      return image ? { ...subject, image } : null;
    } catch {
      return null;
    }
  }));
  return loaded.filter(Boolean);
}

/** "image 2 = @sam's profile picture" labels for a prompt. */
export function avatarRoles(avatars, offset = 0) {
  return avatars.map((avatar, i) => `image ${offset + i + 1} = ${avatar.bot ? "your own" : `@${avatar.name}'s`} profile picture`).join("; ");
}

/**
 * Resolve [[pfp: ...]] tool targets — "me", "you", <@id>, @name or a plain
 * name — to people in this conversation's server (or DM), with avatar URLs.
 */
export function resolveAvatarTargets(names, message, client) {
  const subjects = new Map();
  const people = new Map();
  const remember = (user, member) => { if (user && !user.bot) people.set(user.id, { user, member }); };
  for (const member of message.guild?.members?.cache?.values() || []) remember(member.user, member);
  for (const recent of message.channel?.messages?.cache?.values() || []) remember(recent.author, recent.member);
  for (const user of message.mentions?.users?.values() || []) remember(user, message.mentions.members?.get?.(user.id));
  if (!message.guild && message.channel?.recipient) remember(message.channel.recipient, null);

  for (const raw of names.slice(0, 3)) {
    const name = String(raw).trim().replace(/^@/, "").toLowerCase();
    let found = null;
    if (/^(?:me|my|myself|mine)$/.test(name)) found = { user: message.author, member: message.member };
    else if (/^(?:you|your|yours|yourself|bot)$/.test(name)) found = { user: client.user, member: message.guild?.members?.me };
    else {
      const id = name.match(/^<@!?(\d+)>$/)?.[1] || (/^\d{17,20}$/.test(name) ? name : null);
      const candidates = [...people.values()];
      const namesOf = ({ user, member }) => [member?.displayName, user.globalName, user.username].filter(Boolean).map(n => n.toLowerCase());
      found = id ? people.get(id) || null
        : candidates.find(p => namesOf(p).includes(name)) || candidates.find(p => namesOf(p).some(n => n.startsWith(name))) || null;
    }
    if (!found?.user) continue;
    const url = avatarUrl(found.user, found.member);
    if (url) subjects.set(found.user.id, { id: found.user.id, name: displayName(found.user, found.member), url, bot: found.user.id === client.user?.id });
  }
  return [...subjects.values()];
}
