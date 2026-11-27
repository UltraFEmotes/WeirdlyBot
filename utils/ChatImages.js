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

// Only Discord-hosted media: uploads, Discord's proxy for embedded image links
// (imgur, tenor, direct .png links...), sticker images and profile pictures.
export function discordMediaUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    if (DISCORD_CDN.has(url.hostname) &&
        /^\/(?:attachments|stickers|avatars|embed\/avatars|guilds\/\d+\/users\/\d+\/avatars)\//.test(url.pathname)) return url;
    if (/^images-ext-\d+\.discordapp\.net$/.test(url.hostname) && url.pathname.startsWith("/external/")) return url;
    return null;
  } catch {
    return null;
  }
}

/**
 * Every image a message carries: attachments, image/gif link embeds and
 * non-animated stickers, in that order.
 * @returns {{ url: string, name: string, size?: number, width?: number, height?: number, kind: string }[]}
 */
export function imageSources(message) {
  const sources = [];
  for (const attachment of message.attachments?.values() || []) {
    if (!isImageAttachment(attachment) || !discordMediaUrl(attachment.url)) continue;
    sources.push({ url: attachment.url, name: attachment.name || "image", size: attachment.size,
      width: attachment.width, height: attachment.height, kind: "attachment" });
  }
  for (const embed of message.embeds || []) {
    // A pasted image or tenor link becomes an "image"/"gifv" embed; article
    // previews (youtube, news) are left out so their thumbnails aren't edited.
    if (!["image", "gifv"].includes(embed.type)) continue;
    const media = embed.image?.proxyURL ? embed.image : embed.thumbnail;
    if (!discordMediaUrl(media?.proxyURL)) continue;
    sources.push({ url: media.proxyURL, name: embed.provider?.name || "linked image",
      width: media.width, height: media.height, kind: "embed" });
  }
  for (const sticker of message.stickers?.values() || []) {
    if (!["PNG", "APNG", 1, 2].includes(sticker.format)) continue;
    const url = `https://media.discordapp.net/stickers/${sticker.id}.png?size=320`;
    if (/^\d+$/.test(sticker.id || "")) sources.push({ url, name: `sticker ${sticker.name || ""}`.trim(), kind: "sticker" });
  }
  return sources;
}

export function hasChatImage(message) {
  return imageSources(message).length > 0;
}

export function getDiscordImageUrls(messages) {
  const urls = new Set();
  for (const message of messages) {
    for (const source of imageSources(message)) {
      urls.add(discordMediaUrl(source.url).href);
      if (urls.size >= MAX_IMAGES) return [...urls];
    }
  }
  return [...urls];
}

export function wantsImageText(text) {
  return /\b(?:ocr|transcrib(?:e|ing)|(?:extract|read|copy|pull|get)\b.{0,25}\b(?:the\s+)?text|what(?:'s| is) written|what (?:does|do) (?:this|that|it|the image|the screenshot) say)\b/i.test(text);
}

export function refersToImage(text) {
  return wantsImageText(text) || /\b(?:image|picture|photo|screenshot|pic|attachment|sticker|gif|meme)\b/i.test(text);
}

export async function readDiscordImage(source) {
  const url = discordMediaUrl(source.url);
  if (!url || source.size > MAX_DOWNLOAD_BYTES) return null;

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
    for (const source of imageSources(message)) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      candidates.push(source);
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
