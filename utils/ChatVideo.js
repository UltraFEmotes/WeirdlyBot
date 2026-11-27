import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import axios from "axios";
import { discordMediaUrl } from "./ChatImages.js";
import { log } from "./functions.js";

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const FRAME_COUNT = 6;
let ffmpegMissing = false;

export function isVideoAttachment(file) {
  return /^video\//i.test(file.contentType || "") || /\.(?:mp4|mov|m4v|webm|avi|mkv|mpeg|mpg)$/i.test(file.name || "");
}

export function hasChatVideo(message) {
  return [...(message.attachments?.values() || [])].some(isVideoAttachment);
}

function run(command, args, timeout = 15_000) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/** Evenly spaced timestamps that skip the very first and last instant. */
export function frameTimes(duration, count = FRAME_COUNT) {
  if (!(duration > 0)) return [0];
  const n = Math.max(1, Math.min(count, Math.ceil(duration)));
  return Array.from({ length: n }, (_, i) => Number(((duration * (i + 0.5)) / n).toFixed(2)));
}

/**
 * Pull a few still frames out of the newest attached video so the vision
 * model can see it. Needs ffmpeg/ffprobe on PATH; without them this returns
 * nothing and the bot says it couldn't load the video.
 * @returns {Promise<{ name: string, duration: number, frames: { at: number, url: string }[] } | null>}
 */
export async function collectVideoFrames(messages) {
  if (ffmpegMissing) return null;
  const file = [...messages].reverse().flatMap(message => [...(message.attachments?.values() || [])])
    .find(attachment => isVideoAttachment(attachment) && discordMediaUrl(attachment.url));
  if (!file || file.size > MAX_VIDEO_BYTES) return null;

  const dir = await mkdtemp(path.join(tmpdir(), "weirdlybot-video-"));
  try {
    const { data } = await axios.get(discordMediaUrl(file.url).href, {
      responseType: "arraybuffer", timeout: 30_000, maxContentLength: MAX_VIDEO_BYTES, maxRedirects: 0,
    });
    const input = path.join(dir, "input");
    await writeFile(input, data);
    const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", input]);
    const duration = Number.parseFloat(probe) || 0;
    const frames = await Promise.all(frameTimes(duration).map(async (at, i) => {
      const output = path.join(dir, `frame-${i}.jpg`);
      try {
        await run("ffmpeg", ["-v", "error", "-ss", String(at), "-i", input, "-frames:v", "1",
          "-vf", "scale='min(768,iw)':-2", "-q:v", "4", "-y", output]);
        return { at, url: `data:image/jpeg;base64,${(await readFile(output)).toString("base64")}` };
      } catch {
        return null;
      }
    }));
    const usable = frames.filter(Boolean);
    return usable.length ? { name: (file.name || "video").slice(0, 120), duration, frames: usable } : null;
  } catch (error) {
    if (error.code === "ENOENT") {
      ffmpegMissing = true;
      log("video understanding needs ffmpeg and ffprobe on PATH", "warn");
    } else {
      log(`video frame extraction failed — ${error.message}`, "debug");
    }
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
