import axios from "axios";
import sharp from "sharp";

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 1_200_000;
const MAX_IMAGES = 4;
const DISCORD_CDN = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

export function isImageAttachment(attachment) {
  return /^image\/(?:png|jpe?g|webp|gif|avif|tiff|bmp)(?:$|;)/i.test(attachment.contentType || "") ||
    /\.(?:png|jpe?g|webp|gif|avif|tiff|bmp)$/i.test(attachment.name || "");
}

export function hasChatImage(message) {
  return [...(message.attachments?.values() || [])].some(isImageAttachment);
}

export function getDiscordImageUrls(messages) {
  const urls = new Set();
  for (const message of messages) {
    for (const attachment of message.attachments?.values() || []) {
      if (!isImageAttachment(attachment)) continue;
      try {
        const url = new URL(attachment.url);
        if (url.protocol !== "https:" || !DISCORD_CDN.has(url.hostname) || url.port || url.username ||
            url.password || !url.pathname.startsWith("/attachments/")) continue;
        urls.add(url.href);
        if (urls.size >= MAX_IMAGES) return [...urls];
      } catch { /* skip malformed attachment URL */ }
    }
  }
  return [...urls];
}

export function wantsImageText(text) {
  return /\b(?:ocr|transcrib(?:e|ing)|(?:extract|read|copy|pull|get)\b.{0,25}\b(?:the\s+)?text|what(?:'s| is) written|what (?:does|do) (?:this|that|it|the image|the screenshot) say)\b/i.test(text);
}

export function refersToImage(text) {
  return wantsImageText(text) || /\b(?:image|picture|photo|screenshot|pic|attachment)\b/i.test(text);
}

async function readDiscordImage(attachment) {
  const url = new URL(attachment.url);
  if (url.protocol !== "https:" || !DISCORD_CDN.has(url.hostname) || url.username || url.password ||
      url.port || !url.pathname.startsWith("/attachments/") || attachment.size > MAX_DOWNLOAD_BYTES) return null;

  const { data } = await axios.get(url.href, {
    responseType: "arraybuffer", timeout: 10_000, maxContentLength: MAX_DOWNLOAD_BYTES, maxRedirects: 0,
  });
  const image = sharp(data, { animated: false, limitInputPixels: 40_000_000 });
  const { format } = await image.metadata();
  if (!["jpeg", "png", "webp", "gif", "heif", "tiff", "bmp"].includes(format)) return null;
  const encode = (size, quality) => image.clone().rotate()
    .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" }).jpeg({ quality }).toBuffer();
  let buffer = await encode(2048, 92);
  if (buffer.length > MAX_IMAGE_BYTES) buffer = await encode(1600, 85);
  return buffer.length <= MAX_IMAGE_BYTES ? `data:image/jpeg;base64,${buffer.toString("base64")}` : null;
}

export async function collectChatImages(messages) {
  const candidates = [];
  const seen = new Set();
  for (const message of messages) {
    for (const attachment of message.attachments?.values() || []) {
      if (!isImageAttachment(attachment) || seen.has(attachment.url)) continue;
      seen.add(attachment.url);
      candidates.push(attachment);
      if (candidates.length >= MAX_IMAGES) break;
    }
    if (candidates.length >= MAX_IMAGES) break;
  }
  const results = await Promise.allSettled(candidates.map(readDiscordImage));
  return results.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
}

export function imageMessageContent(text, images) {
  return images.length ? [
    { type: "text", text },
    ...images.map((url) => ({ type: "image_url", image_url: { url } })),
  ] : text;
}
