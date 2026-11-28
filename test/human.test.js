import assert from "node:assert/strict";
import test from "node:test";
import { avatarRoles, avatarSubjects, mentionsAvatar } from "../utils/Avatars.js";
import { channelStyle, lengthHint, timeAndMood } from "../utils/ChannelVibe.js";
import { discordMediaUrl } from "../utils/ChatImages.js";
import { meaningfulEdit } from "../utils/EditAwareness.js";
import { applyCustomEmoji, naturalize, naturalizeReply, rememberReply, repetitionHint } from "../utils/Naturalizer.js";
import { parseNotes } from "../utils/PeopleMemory.js";
import { isAudioAttachment } from "../utils/VoiceMessages.js";

const map = (items, key = (_, i) => String(i)) => new Map(items.map((item, i) => [key(item, i), item]));

test("naturalize strips assistant tells but keeps links, code and acronyms", () => {
  assert.equal(naturalize("Great question! It works — mostly. I hope this helps!"), "it works, mostly.");
  assert.equal(naturalize("**Sure** here:\n- one\n- two"), "sure here:\none\ntwo");
  assert.equal(naturalize("GTA 6 is out, check https://Example.com/Page and `MyVar`"), "GTA 6 is out, check https://Example.com/Page and `MyVar`");
  assert.equal(naturalize("pages 10–20"), "pages 10-20");
  assert.equal(naturalize("Hello There", { lowercase: false }), "Hello There");
});

test("naturalizeReply drops a repeated opener and a habitual closing question", () => {
  const channel = "c1";
  for (const text of ["lol yeah", "lol same what about you?", "ok what do you think?", "nah why?"]) rememberReply(channel, text);
  assert.deepEqual(naturalizeReply(["lol that's wild. what game?"], channel), ["that's wild."]);
  assert.match(repetitionHint(channel), /started with/);
});

test("applyCustomEmoji only uses emoji the account can send", () => {
  const guild = { emojis: { cache: map([
    { id: "1", name: "pepeLaugh", animated: false, available: true },
    { id: "2", name: "partyBlob", animated: true, available: true },
  ], e => e.id) } };
  assert.equal(applyCustomEmoji("bro :pepelaugh: :partyblob:", guild), "bro <:pepeLaugh:1> :partyblob:");
  assert.equal(applyCustomEmoji(":partyblob:", guild, { allowAnimated: true }), "<a:partyBlob:2>");
  assert.equal(applyCustomEmoji("time is 10:30:00", guild), "time is 10:30:00");
});

test("channelStyle summarises how people type", () => {
  const messages = ["lol fr", "nah thats crazy lol", "fr fr", "who up", "bro what 😭", "lmao no way", "lol ok"]
    .map((content, i) => ({ id: String(i), content, author: { id: `u${i}`, bot: false }, createdTimestamp: i }));
  const style = channelStyle({ messages: { cache: map(messages) } }, "bot");
  assert.match(style, /very short messages/);
  assert.match(style, /mostly lowercase/);
  assert.match(style, /lol/);
  assert.match(lengthHint("lol"), /tiny/);
  assert.equal(lengthHint("so what i was thinking is we could maybe go to the place after school if you want"), "");
  assert.match(timeAndMood("guild:1", "UTC"), /today you're/);
});

test("meaningfulEdit ignores typo fixes", () => {
  assert.equal(meaningfulEdit("what time is the gmae tonight", "what time is the game tonight"), false);
  assert.equal(meaningfulEdit("is the game tonight", "actually is the movie tomorrow instead"), true);
});

test("parseNotes reads a JSON array even inside a code fence", () => {
  assert.deepEqual(parseNotes('```json\n["likes portal 2", "exam on 2026-12-04"]\n```'), ["likes portal 2", "exam on 2026-12-04"]);
  assert.equal(parseNotes("sorry, no"), null);
});

test("avatarSubjects finds mentioned users, 'me' and the bot", () => {
  const user = (id, name) => ({ id, username: name, displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}/abc.png?size=512` });
  const client = { user: user("99", "bot") };
  const sam = user("1", "sam");
  const message = (content, mentions = []) => ({ content, author: user("2", "me"), member: null, guild: null,
    mentions: { users: map(mentions, u => u.id), members: new Map() } });
  assert.deepEqual(avatarSubjects([message("draw @sam as a knight", [sam])], client).map(s => s.name), ["sam"]);
  assert.deepEqual(avatarSubjects([message("make an image of me as a cat")], client).map(s => s.name), ["me"]);
  assert.deepEqual(avatarSubjects([message("make me a cat picture")], client), []);
  assert.deepEqual(avatarSubjects([message("animate your pfp")], client).map(s => s.bot), [true]);
  assert.equal(mentionsAvatar("what's in his pfp"), true);
  assert.equal(avatarRoles([{ name: "sam" }], 1), "image 2 = @sam's profile picture");
  assert.ok(discordMediaUrl("https://cdn.discordapp.com/avatars/1/abc.png?size=512"));
  assert.ok(discordMediaUrl("https://cdn.discordapp.com/guilds/5/users/1/avatars/abc.png"));
});

test("voice messages are recognised as audio", () => {
  assert.equal(isAudioAttachment({ name: "voice-message.ogg", contentType: "audio/ogg" }), true);
  assert.equal(isAudioAttachment({ name: "notes.txt", contentType: "text/plain" }), false);
});

test("resolveAvatarTargets finds people by name, @name, me and you", async () => {
  const { resolveAvatarTargets } = await import("../utils/Avatars.js");
  const user = (id, username, globalName) => ({ id, username, globalName, bot: false,
    displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}/x.png` });
  const sam = user("1", "sam_99", "Sammy");
  const me = user("2", "weirdmm", "WeirdMM");
  const client = { user: { ...user("99", "qwen"), bot: false } };
  const message = { author: me, member: null, guild: null, mentions: { users: new Map(), members: new Map() },
    channel: { messages: { cache: new Map([["m1", { author: sam, member: null }]]) } } };
  const names = (list) => resolveAvatarTargets(list, message, client).map(s => s.name);
  assert.deepEqual(names(["sammy"]), ["Sammy"]);
  assert.deepEqual(names(["@sam"]), ["Sammy"]);
  assert.deepEqual(names(["me"]), ["WeirdMM"]);
  assert.deepEqual(names(["you"]).length, 1);
  assert.deepEqual(names(["nobody"]), []);
});

test("replying to someone's image makes it the edit source", async () => {
  const { imageEditSources } = await import("../utils/ImageEdits.js");
  const photo = { id: "p1", content: "", author: { id: "5" }, embeds: [], stickers: new Map(),
    attachments: new Map([["a", { name: "cat.png", contentType: "image/png", url: "https://cdn.discordapp.com/attachments/1/2/cat.png", width: 800, height: 600 }]]) };
  const reply = { id: "r1", content: "make him wear a crown", author: { id: "2" }, embeds: [], stickers: new Map(),
    attachments: new Map(), reference: { messageId: "p1" } };
  assert.deepEqual(imageEditSources([reply], [photo], null, { botId: "99" }).map(m => m.id), ["p1"]);
});

test("chime-ins wait for a quiet bot and a lively channel", async () => {
  const { createChimeIns } = await import("../utils/ChimeIn.js");
  const minute = 60_000;
  let clock = 100 * minute;
  const posted = [];
  let stored = null;
  let searched = 0;
  const chimes = createChimeIns({
    lastSpokeAt: () => stored,
    noteSpoke: (_, at) => { stored = at; },
    searchLastSpoke: async () => searched,
    quietMs: () => 5 * minute,
    generate: async () => "wait who said that",
    post: async (_, text) => { posted.push(text); },
    now: () => clock, random: () => 0, wait: async () => {},
  });
  const people = ["a", "b", "a"].map((id, i) => ({ id: String(i), author: { id, bot: false }, content: "lol",
    createdTimestamp: clock - minute + i }));
  const channel = { name: "general", permissionsFor: () => ({ has: () => true }),
    messages: { cache: new Map(people.map(m => [m.id, m])) } };
  const guild = { id: "g", name: "test" };
  const message = { ...people.at(-1), channel, guild, client: { user: { id: "bot", bot: false } } };

  await chimes.noteMessage(message); // never spoke there → says something
  assert.deepEqual(posted, ["wait who said that"]);
  await chimes.noteMessage(message); // just spoke → stays quiet
  assert.equal(posted.length, 1);

  clock += 6 * minute; // quiet for 6 minutes, chat still going
  for (const m of people) m.createdTimestamp = clock - minute;
  searched = clock - 2 * minute; // but search shows it spoke 2 minutes ago (posted by hand)
  stored = clock - 7 * minute;
  await chimes.noteMessage(message);
  assert.equal(posted.length, 1);
  assert.equal(stored, searched);
});
