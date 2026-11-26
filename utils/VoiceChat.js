import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import {
  AudioPlayerStatus, EndBehaviorType, NoSubscriberBehavior, VoiceConnectionStatus,
  createAudioPlayer, createAudioResource, entersState, joinVoiceChannel,
} from "@discordjs/voice";
import prism from "prism-media";
import AIManager from "./AIManager.js";
import { loadConfig, log } from "./functions.js";
import { isAdmin, isWhitelisted } from "./WhitelistStore.js";

const run = promisify(execFile);
const NO_MENTIONS = { parse: [] };
let session;

export function stopVoiceChat() {
  const active = session;
  session = undefined;
  if (!active) return;
  active.turn?.abort.abort();
  active.player?.stop(true);
  if (active.connection && active.connection.state.status !== VoiceConnectionStatus.Destroyed) {
    active.connection.destroy();
  }
}

function inChannel(active, userId) {
  return active.guild.voiceStates.cache.get(userId)?.channelId === active.channelId;
}

function stillListening(active, userId) {
  return session === active && active.optedIn.has(userId) &&
    isWhitelisted(active.guild.id) && inChannel(active, userId);
}

export function onVoiceStateUpdate(oldState, newState) {
  const active = session;
  if (!active || active.guild.id !== newState.guild.id || oldState.channelId !== active.channelId
      || newState.channelId === active.channelId) return;
  if (newState.id === active.guild.client.user.id) {
    stopVoiceChat();
    return;
  }
  active.optedIn.delete(newState.id);
  active.history.delete(newState.id);
  if (active.turn?.userId === newState.id) {
    active.turn.abort.abort();
    active.player?.stop(true);
  }
}

async function captureSpeech(connection, userId, signal) {
  const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
  const opus = connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 750 },
  });
  const chunks = [];
  const timer = setTimeout(() => opus.push(null), 8_000);
  try {
    await pipeline(opus, decoder, new Writable({
      write(chunk, _encoding, done) { chunks.push(chunk); done(); },
    }), { signal });
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}

async function transcribe(pcm, signal) {
  if (pcm.length < 48_000) return "";
  const folder = await mkdtemp(join(tmpdir(), "weirdlybot-voice-"));
  try {
    const raw = join(folder, "speech.raw");
    const wav = join(folder, "speech.wav");
    const output = join(folder, "transcript");
    await writeFile(raw, pcm, { mode: 0o600, signal });
    await run("ffmpeg", ["-nostdin", "-loglevel", "error", "-f", "s16le", "-ar", "48000",
      "-ac", "2", "-i", raw, "-ar", "16000", "-ac", "1", wav], { timeout: 10_000, signal });
    await run(process.env.WHISPER_CLI || "whisper-cli", ["-m", process.env.WHISPER_MODEL_PATH,
      "-f", wav, "-l", "auto", "-nt", "-otxt", "-of", output], { timeout: 45_000, signal });
    return (await readFile(`${output}.txt`, { encoding: "utf8", signal })).trim().slice(0, 800);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function synthesize(text, cfg, signal) {
  const provider = cfg.ai?.openai;
  const key = process.env[provider?.api_key_env || "FLAMA_API_KEY"]?.trim();
  const path = cfg.voice?.tts_path || "/audio";
  if (!key || !provider?.base_url || !/^\/audio(?:\/speech)?$/.test(path)) {
    throw new Error("Voice TTS requires a Flama base URL, API key and /audio or /audio/speech path.");
  }
  const response = await fetch(`${provider.base_url.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.voice?.tts_model || "magpie-tts-zeroshot", input: text,
      response_format: "mp3", ...(cfg.voice?.tts_voice ? { voice: cfg.voice.tts_voice } : {}) }),
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  const type = response.headers.get("content-type") || "";
  if (!response.ok || !response.body || !/^(audio\/|application\/octet-stream)/i.test(type)) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Flama TTS did not return audio (HTTP ${response.status}).`);
  }
  return Readable.fromWeb(response.body);
}

async function handleSpeech(active, userId) {
  if (active.turn || !stillListening(active, userId)) return;
  const abort = new AbortController();
  active.turn = { userId, abort };
  const { signal } = abort;
  let audio;
  try {
    const pcm = await captureSpeech(active.connection, userId, signal);
    const transcript = await transcribe(pcm, signal);
    if (!transcript || !stillListening(active, userId)) return;
    const cfg = loadConfig();
    const chain = cfg.ai?.provider_chain || [cfg.ai?.default_provider || "openai"];
    const { text } = await AIManager.chainGenerateWithHistory([
      { role: "system", content: "You are an AI in a Discord voice chat. The next message is an automatic transcript. Give a natural spoken reply in one or two short sentences. No tool markers, markdown, or links." },
      ...(active.history.get(userId) || []),
      { role: "user", content: transcript },
    ], chain);
    const reply = text?.replace(/\[\[[\s\S]*?\]\]/g, "").trim().slice(0, 350);
    if (!reply || signal.aborted || !stillListening(active, userId)) return;
    audio = await synthesize(reply, cfg, signal);
    if (!stillListening(active, userId) || signal.aborted) return;
    active.player.play(createAudioResource(audio));
    await entersState(active.player, AudioPlayerStatus.Playing, AbortSignal.any([signal, AbortSignal.timeout(12_000)]));
    await entersState(active.player, AudioPlayerStatus.Idle, AbortSignal.any([signal, AbortSignal.timeout(45_000)]));
    if (stillListening(active, userId) && !signal.aborted) {
      active.history.set(userId, [{ role: "user", content: transcript }, { role: "assistant", content: reply }]);
    }
  } catch (error) {
    if (!signal.aborted) log(`Voice turn failed: ${error.message}`, "warn");
  } finally {
    active.player.stop(true);
    audio?.destroy();
    active.turn = undefined;
  }
}

export async function handleVoiceCommand(_client, message) {
  const match = message.content?.trim().match(/^!(joinvc|leavevc|voiceon|voiceoff)(?=\s|$)\s*(.*)$/i);
  if (!match) return false;
  const [, command, arg] = match;
  const name = command.toLowerCase();
  const send = (content) => message.channel.send({ content, allowedMentions: NO_MENTIONS }).catch(() => null);
  if ((name === "joinvc" || name === "leavevc") && !isAdmin(message.author.id)) return true;
  if (name === "leavevc") {
    if (session?.guild.id === message.guild?.id && session) {
      stopVoiceChat();
      await send("Left voice chat.");
    }
    return true;
  }
  if (name === "voiceon" || name === "voiceoff") {
    const active = session;
    const userId = message.author.id;
    if (!active || active.guild.id !== message.guild?.id) return true;
    if (name === "voiceoff") {
      active.optedIn.delete(userId);
      active.history.delete(userId);
      if (active.turn?.userId === userId) {
        active.turn.abort.abort();
        active.player?.stop(true);
      }
      await send("Voice input is off for you.");
    } else if (inChannel(active, userId)) {
      active.optedIn.add(userId);
      await send("Voice input is on for you until you leave the channel or use `!voiceoff`.");
    }
    return true;
  }
  const guild = message.guild;
  const channelId = arg.match(/^(?:<#)?(\d{17,20})>?$/)?.[1];
  if (!guild || !isWhitelisted(guild.id) || !channelId) {
    await send("Use `!joinvc <voice channel ID>` in a whitelisted server.");
    return true;
  }
  const voice = guild.channels.cache.get(channelId);
  if (voice?.type !== "GUILD_VOICE" && voice?.type !== 2) {
    await send("That ID isn't a voice channel in this server.");
    return true;
  }
  if (!process.env.WHISPER_MODEL_PATH) {
    await send("Voice transcription isn't set up yet. Set `WHISPER_MODEL_PATH` in `.env`.");
    return true;
  }
  if (session) {
    await send("Already joining or in a voice channel. Use `!leavevc` first.");
    return true;
  }
  const active = { guild, channelId, optedIn: new Set(), history: new Map() };
  session = active;
  try {
    const notice = await send(`Joining <#${channelId}>. Voice is off by default. While in that channel, use \`!voiceon\` to let the bot transcribe you locally and send your transcript to Flama. Use \`!voiceoff\` to stop. Audio is not retained after transcription.`);
    if (!notice || session !== active) return true;
    active.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
    active.player.on("error", (error) => log(`Voice playback failed: ${error.message}`, "warn"));
    active.connection = joinVoiceChannel({ guildId: guild.id, channelId,
      adapterCreator: guild.voiceAdapterCreator, selfDeaf: false, selfMute: false });
    active.connection.on("error", (error) => log(`Voice connection failed: ${error.message}`, "warn"));
    await entersState(active.connection, VoiceConnectionStatus.Ready, 20_000);
    if (session !== active) return true;
    active.connection.subscribe(active.player);
    active.connection.receiver.speaking.on("start", (userId) => void handleSpeech(active, userId));
    active.connection.once(VoiceConnectionStatus.Destroyed, () => { if (session === active) stopVoiceChat(); });
    active.connection.once(VoiceConnectionStatus.Disconnected, () => { if (session === active) stopVoiceChat(); });
  } catch (error) {
    if (session === active) stopVoiceChat();
    log(`Could not join voice: ${error.message}`, "warn");
    await send("Couldn't connect to that voice channel.");
  } finally {
    if (session === active && !active.connection) stopVoiceChat();
  }
  return true;
}
