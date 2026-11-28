/**
 * VOICE MESSAGES
 *
 * Transcribes Discord voice messages (and short audio clips) with the local
 * whisper.cpp CLI, so the bot can understand people who send voice notes.
 * Needs ffmpeg plus WHISPER_MODEL_PATH (and optionally WHISPER_CLI) in .env.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import axios from "axios";
import { discordMediaUrl } from "./ChatImages.js";
import { log } from "./functions.js";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_SECONDS = 180;
const transcripts = new Map(); // message id -> transcript ("" when it failed)
let warned = false;

export function isAudioAttachment(file) {
  return /^audio\//i.test(file.contentType || "") || /\.(?:ogg|oga|opus|mp3|m4a|wav|flac|aac|weba)$/i.test(file.name || "");
}

export function hasVoiceMessage(message) {
  return [...(message.attachments?.values() || [])].some(isAudioAttachment);
}

function run(command, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

async function transcribeFile(file) {
  const url = discordMediaUrl(file.url);
  if (!url || file.size > MAX_AUDIO_BYTES || (file.duration && file.duration > MAX_SECONDS)) return "";
  const dir = await mkdtemp(path.join(tmpdir(), "weirdlybot-voicemsg-"));
  try {
    const { data } = await axios.get(url.href, {
      responseType: "arraybuffer", timeout: 20_000, maxContentLength: MAX_AUDIO_BYTES, maxRedirects: 0,
    });
    const input = path.join(dir, "input");
    const wav = path.join(dir, "audio.wav");
    const output = path.join(dir, "transcript");
    await writeFile(input, data);
    await run("ffmpeg", ["-nostdin", "-v", "error", "-i", input, "-t", String(MAX_SECONDS), "-ar", "16000", "-ac", "1", "-y", wav], 20_000);
    await run(process.env.WHISPER_CLI || "whisper-cli", ["-m", process.env.WHISPER_MODEL_PATH,
      "-f", wav, "-l", "auto", "-nt", "-otxt", "-of", output], 90_000);
    return (await readFile(`${output}.txt`, "utf8")).replace(/\s+/g, " ").trim().slice(0, 1500);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Transcribe any voice messages in these messages (once each). Results are
 * kept so the relevance judge and the reply both see the same text.
 */
export async function transcribeVoiceMessages(messages) {
  if (!process.env.WHISPER_MODEL_PATH) {
    if (!warned && messages.some(hasVoiceMessage)) {
      warned = true;
      log("voice message received — set WHISPER_MODEL_PATH in .env to transcribe them", "warn");
    }
    return;
  }
  await Promise.all(messages.filter(m => hasVoiceMessage(m) && !transcripts.has(m.id)).map(async (message) => {
    const file = [...message.attachments.values()].find(isAudioAttachment);
    transcripts.set(message.id, "");
    try {
      transcripts.set(message.id, await transcribeFile(file));
    } catch (error) {
      log(`voice message transcription failed — ${error.message}`, "debug");
    }
    if (transcripts.size > 500) transcripts.delete(transcripts.keys().next().value);
  }));
}

/** The transcript for a message, "" when it failed, or null if it has none. */
export function voiceTranscript(message) {
  return transcripts.has(message.id) ? transcripts.get(message.id) : null;
}
