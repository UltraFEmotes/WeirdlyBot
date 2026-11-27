import axios from "axios";
import sharp from "sharp";
import { loadConfig } from "./functions.js";
import { h3LabModelId } from "./MediaOptions.js";
import { searchImages } from "./WebSearch.js";

const MAX_DOWNLOAD = 3 * 1024 * 1024;
const HEADERS = { "User-Agent": "WeirdlyBot/2.0 (https://github.com/UltraFEmotes/WeirdlyBot)" };
let active = 0;

function httpsUrl(value, maxLength = 1500) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      url.href.length <= maxLength && !/[<>]/.test(url.href) ? url : null;
  } catch {
    return null;
  }
}

function thumbnailUrl(value) {
  const url = httpsUrl(value);
  if (!url) return null;
  if (url.hostname === "external-content.duckduckgo.com" && url.pathname === "/iu/") return url;
  if (/^(?:tse[1-4]|th)\.mm\.bing\.net$/.test(url.hostname) && url.pathname === "/th") return url;
  if (["upload.wikimedia.org", "thumb.wikimedia.org"].includes(url.hostname) &&
      url.pathname.startsWith("/wikipedia/commons/")) return url;
  return null;
}

async function commonsImages(query) {
  const { data } = await axios.get("https://commons.wikimedia.org/w/api.php", {
    params: {
      action: "query", generator: "search", gsrsearch: query, gsrnamespace: 6, gsrlimit: 6,
      prop: "imageinfo", iiprop: "url|mime", iiurlwidth: 960, format: "json", formatversion: 2,
    },
    headers: HEADERS, maxRedirects: 0, maxContentLength: 256_000, signal: AbortSignal.timeout(5_000),
  });
  return (data.query?.pages || []).sort((a, b) => a.index - b.index).flatMap(page => {
    const info = page.imageinfo?.[0];
    return info && /^image\/(?:jpeg|png|webp)$/.test(info.mime)
      ? [{ thumbnail: info.thumburl || info.url, url: info.descriptionurl }] : [];
  });
}

async function firstUsable(results) {
  const candidates = (Array.isArray(results) ? results : []).flatMap(result => {
    const thumbnail = thumbnailUrl(result?.thumbnail);
    const source = httpsUrl(result?.url, 400);
    return thumbnail && source ? [{ thumbnail, source }] : [];
  }).slice(0, 3);
  const images = await Promise.all(candidates.map(async ({ thumbnail, source }) => {
    try {
      const { data } = await axios.get(thumbnail.href, {
        headers: HEADERS, responseType: "arraybuffer", maxRedirects: 0,
        maxContentLength: MAX_DOWNLOAD, signal: AbortSignal.timeout(5_000),
      });
      const image = sharp(data, { limitInputPixels: 12_000_000 });
      const { format } = await image.metadata();
      if (!["jpeg", "png", "webp"].includes(format)) return null;
      const jpeg = await image.rotate().resize(960, 960, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
      return { options: { references: [`data:image/jpeg;base64,${jpeg.toString("base64")}`] },
        caption: `Web reference: <${source.href}>` };
    } catch {
      return null;
    }
  }));
  return images.find(Boolean);
}

export async function webImageReference(query, video, model, { required = false } = {}) {
  if (!query) return { options: {} };
  const fail = (reason) => {
    if (!required) return { options: {}, caption: `Generated without a web reference: ${reason}` };
    throw Object.assign(new Error(reason), { publicMessage: reason });
  };
  const terms = query.replace(/\s+/g, " ").trim().slice(0, 150);
  if (!terms || /https?:\/\/|<@/i.test(terms)) return fail("Use plain search terms for a reference image.");
  const ai = loadConfig().ai;
  const provider = ai?.[video ? ai.video_provider || "openai" : ai.image_provider || "openai"];
  if (h3LabModelId(model || provider?.[video ? "video_model" : "image_model"], video)) {
    return fail("That model doesn't support web references. Try a Flama model.");
  }
  if (active >= 2) return fail("Reference image search is busy. Try again in a moment.");
  active += 1;
  try {
    const web = await searchImages(terms).then(firstUsable).catch(() => null);
    const result = web || await commonsImages(terms).then(firstUsable).catch(() => null);
    return result || fail("Couldn't find a usable reference image. Try a more specific search.");
  } finally {
    active -= 1;
  }
}
