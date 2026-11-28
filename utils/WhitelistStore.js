/**
 * WHITELIST STORE
 *
 * The AI only talks in whitelisted servers (DMs are always on).
 * Whitelist is managed in-chat with the !whitelistserver command and
 * persisted to data/whitelisted_servers.json (gitignored).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "./functions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const WHITELIST_FILE = path.join(DATA_DIR, "whitelisted_servers.json");

/** The only Discord user allowed to manage the whitelist */
export function isAdmin(userId) {
  const adminId = loadConfig().admin_user_id;
  return typeof adminId === "string" && adminId.length > 0 && userId === adminId;
}

let cache = null;

function load() {
  if (cache) return cache;
  try {
    if (!fs.existsSync(WHITELIST_FILE)) {
      cache = {};
      return cache;
    }
    const parsed = JSON.parse(fs.readFileSync(WHITELIST_FILE, "utf8"));
    cache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(WHITELIST_FILE, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.error("[WHITELIST] failed to save:", error.message);
  }
}

/**
 * Whether the AI is allowed to talk in this guild.
 */
export function isWhitelisted(guildId) {
  return !!load()[guildId];
}

/**
 * Add a guild to the whitelist.
 * @param {import('@lng2004/discord.js-selfbot-v13').Guild} guild
 */
export function addServer(guild) {
  const list = load();
  list[guild.id] = {
    name: guild.name || "unknown server",
    addedAt: new Date().toISOString(),
  };
  save();
}

/**
 * Remove a guild from the whitelist. Returns true if it was on it.
 */
export function removeServer(guildId) {
  const list = load();
  const existed = !!list[guildId];
  if (existed) {
    delete list[guildId];
    save();
  }
  return existed;
}

/**
 * A copy of the whitelist: { guildId: { name, addedAt } }
 */
export function listServers() {
  return { ...load() };
}

/** When the account last sent a message in this server (ms), if known. */
export function lastSpokeAt(guildId) {
  const at = Date.parse(load()[guildId]?.lastSpokeAt || "");
  return Number.isFinite(at) ? at : null;
}

let lastSpokeSave = 0;

/** Remember the account spoke in a whitelisted server (kept exact in memory, saved at most every 10 minutes). */
export function noteSpoke(guildId, at = Date.now()) {
  const entry = load()[guildId];
  const known = lastSpokeAt(guildId);
  if (!entry || (known !== null && at <= known)) return;
  entry.lastSpokeAt = new Date(at).toISOString();
  if (Date.now() - lastSpokeSave >= 10 * 60_000) {
    lastSpokeSave = Date.now();
    save();
  }
}

export function countServers() {
  return Object.keys(load()).length;
}
