import { h3VideoDuration } from "./MediaOptions.js";

const BASE_URL = "https://minimax-h3-api.kizil-gecit.workers.dev";
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_EVENT_CHARS = 256_000;
const DISCORD_CDN = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const IMAGE_SIZES = {
  "flux-2-dev": [256, 4096, 256, 4096, 16],
  "flux-3-klein": [256, 4096, 256, 4096, 16],
  "fibo-2-t2i": [832, 1344, 768, 1248, 16],
  anima: [512, 1536, 512, 1536, 64],
  "moss-nsfw": [512, 1536, 512, 1536, 64],
  "z-image-turbo": [256, 2048, 256, 2048, 16],
  "z-image": [256, 2048, 256, 2048, 16],
  "pollinations-flux": [256, 2048, 256, 2048, 16],
};
const IMAGE_ASPECTS = {
  "qwen-image": ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"],
  "qwen-uncensored": ["1:1", "16:9", "9:16", "4:3", "3:4"],
};

export class H3LabError extends Error {
  constructor(publicMessage, detail = "") {
    super(detail ? `${publicMessage} ${detail.slice(0, 250)}` : publicMessage);
    this.publicMessage = publicMessage;
  }
}

function validateReferenceUrls(urls) {
  return (urls || []).slice(0, 4).filter(value => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && DISCORD_CDN.has(url.hostname) && !url.port &&
        !url.username && !url.password && url.pathname.startsWith("/attachments/");
    } catch {
      return false;
    }
  });
}

function imageDimensions(model, aspect) {
  if (!aspect) return {};
  if (IMAGE_ASPECTS[model]) {
    if (IMAGE_ASPECTS[model].includes(aspect)) return { aspect };
    throw new H3LabError(`${model} supports these sizes: ${IMAGE_ASPECTS[model].join(", ")}.`);
  }
  if (["qwen-edit-pro", "flux-kontext"].includes(model) && aspect === "1:1") return {};
  const limits = IMAGE_SIZES[model];
  if (!limits) throw new H3LabError(`Omit --size for ${model}; h3lab doesn't list size controls for it.`);
  const [w, h] = aspect.split(":").map(Number);
  if (!(w > 0 && h > 0)) throw new H3LabError("Give the image size as an aspect ratio, like 16:9.");
  const [minW, maxW, minH, maxH, step] = limits;
  const factor = Math.min(maxW / w, maxH / h, Math.max(1024 / Math.max(w, h), minW / w, minH / h));
  const snap = (value, min, max) => Math.max(min, Math.min(max, Math.round(value / step) * step));
  return { width: snap(w * factor, minW, maxW), height: snap(h * factor, minH, maxH) };
}

function jobPayload(model, prompt, video, options) {
  const payload = { model, prompt: prompt.trim() };
  const references = validateReferenceUrls(options.referenceUrls);
  if (options.references?.length && !references.length) {
    throw new H3LabError("That h3lab model needs an image attached to the Discord message as a reference.");
  }
  if (video) {
    const { min, max } = h3VideoDuration(model);
    if (payload.prompt.length > 2000) throw new H3LabError("h3lab video prompts must be 2,000 characters or fewer.");
    if (options.duration != null) {
      if (!Number.isInteger(options.duration) || options.duration < min || options.duration > max) {
        throw new H3LabError(`${model} supports ${min}–${max} seconds.`);
      }
      payload.duration = options.duration;
    }
    if (references.length) {
      if (model !== "ltx-distilled") throw new H3LabError("Use ltx-distilled for h3lab image-to-video.");
      payload.first_frame_url = references[0];
    }
  } else {
    Object.assign(payload, imageDimensions(model, options.size));
    if (!references.length && ["qwen-edit-pro", "flux-kontext"].includes(model)) {
      throw new H3LabError(`Attach an image to use ${model}.`);
    }
    if (references.length) {
      const count = ["qwen-edit-pro", "qwen-uncensored"].includes(model) ? 2
        : ["fibo-2-t2i", "flux-kontext"].includes(model) ? 1 : 4;
      payload.images = references.slice(0, count);
    }
  }
  return payload;
}

export async function readH3LabCompletion(body) {
  if (!body) throw new H3LabError("h3lab returned no generation stream.");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let separator;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        if (event.length > MAX_EVENT_CHARS) throw new H3LabError("h3lab sent an oversized generation event.");
        const kind = event.match(/^event:\s*(\w+)/m)?.[1];
        if (kind !== "complete" && kind !== "error") continue;
        const rawData = event.split(/\r?\n/).filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).replace(/^ /, "")).join("\n");
        let data;
        try {
          data = JSON.parse(rawData);
        } catch {
          throw new H3LabError("h3lab returned an invalid generation event.");
        }
        if (kind === "error") {
          throw new H3LabError("h3lab's generation engine couldn't complete the request.", String(data?.error?.message || data?.error || ""));
        }
        return data;
      }
      if (buffer.length > MAX_EVENT_CHARS) throw new H3LabError("h3lab sent an oversized generation event.");
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  throw new H3LabError("h3lab closed the stream before generation finished.");
}

function resultPath(completion, video) {
  const item = Array.isArray(completion?.data) ? completion.data[0] : completion?.data;
  const field = video ? "video_url" : "image_url";
  const path = completion?.[field] || item?.[field] || completion?.file_url || item?.file_url || completion?.url || item?.url ||
    (typeof completion?.job_id === "string" ? `/v1/files/${encodeURIComponent(completion.job_id)}` : "");
  let url;
  try { url = new URL(path, BASE_URL); } catch { /* handled below */ }
  if (!url || url.origin !== BASE_URL || url.username || url.password || !/^\/v1\/files\/[a-z0-9_.-]+$/i.test(url.pathname)) {
    throw new H3LabError("h3lab didn't return a supported media download URL.");
  }
  return url;
}

async function downloadH3LabFile(url, key, signal) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal,
  });
  if (!response.ok || !response.body) throw new H3LabError(`Couldn't download the h3lab file (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) throw new H3LabError("The h3lab file is too large to download.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks, size);
}

export async function generateH3LabMedia(model, prompt, video, options = {}) {
  const key = process.env.H3LAB_API_KEY?.trim();
  if (!key) throw new H3LabError("h3lab isn't configured. Set H3LAB_API_KEY in .env and restart the bot.");
  const payload = jobPayload(model, prompt, video, options);
  const signal = AbortSignal.timeout(options.timeout ?? 360_000);
  let response;
  try {
    response = await fetch(`${BASE_URL}/v1/${video ? "generate" : "image"}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(payload), redirect: "error", signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const note = response.status === 429 ? "h3lab is rate-limited or its daily quota has been reached."
        : `h3lab rejected the request (HTTP ${response.status}).`;
      throw new H3LabError(note);
    }
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      await response.body?.cancel().catch(() => {});
      throw new H3LabError("h3lab returned an unexpected generation response.");
    }
    const completion = await readH3LabCompletion(response.body);
    return await downloadH3LabFile(resultPath(completion, video), key, signal);
  } catch (error) {
    if (error instanceof H3LabError) throw error;
    throw new H3LabError(signal.aborted ? "The h3lab request timed out." : "Couldn't reach h3lab or download its output.");
  }
}
