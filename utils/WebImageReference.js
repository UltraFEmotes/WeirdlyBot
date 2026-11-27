import { createHash } from "node:crypto";
import axios from "axios";
import sharp from "sharp";
import { loadConfig } from "./functions.js";
import { h3LabModelId, MAX_WEB_REFERENCES } from "./MediaOptions.js";
import { searchImages } from "./WebSearch.js";

const MAX_DOWNLOAD = 3 * 1024 * 1024;
const HEADERS = { "User-Agent": "WeirdlyBot/2.0 (https://github.com/UltraFEmotes/WeirdlyBot)" };
let active = 0;

export function webReferenceIntent(text) {
  if (/\b(?:no|without|skip|avoid)\s+(?:(?:using|any|online|web|image|external)\s+)*(?:references?|lookups?|search(?:ing)?|web search)\b|\b(?:don't|don’t|do not)\s+(?:look up|search|use\s+(?:(?:any|web|online|image|external)\s+)*references?)\b/i.test(text)) return null;
  if (/\b(?:reference (?:image|photo)s?|(?:image|photo|web|online) references?|as (?:an? |the )?reference|(?:search|look up|find|pull|grab)\b.{0,45}\b(?:images?|photos?|references?))\b/i.test(text)) return "explicit";
  if (/\b(?:accurat(?:e|ely)|faithful(?:ly)?|true.to.life|exactly (?:like|as)|match (?:the|its) (?:actual|real))\b/i.test(text)) return "accuracy";
  return null;
}

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
      prop: "imageinfo", iiprop: "url|mime|size", iiurlwidth: 960, format: "json", formatversion: 2,
    },
    headers: HEADERS, maxRedirects: 0, maxContentLength: 256_000, signal: AbortSignal.timeout(5_000),
  });
  return (data.query?.pages || []).sort((a, b) => a.index - b.index).flatMap(page => {
    const info = page.imageinfo?.[0];
    return info && /^image\/(?:jpeg|png|webp)$/.test(info.mime)
      ? [{ thumbnail: info.thumburl || info.url, original: info.size <= MAX_DOWNLOAD ? info.url : null,
        url: info.descriptionurl }] : [];
  });
}

async function usableImages(results) {
  const candidates = (Array.isArray(results) ? results : []).flatMap(result => {
    const thumbnail = thumbnailUrl(result?.thumbnail);
    const original = thumbnailUrl(result?.original);
    const source = httpsUrl(result?.url, 400);
    return source && (thumbnail || original) ? [{ thumbnail, original, source }] : [];
  }).slice(0, 6);
  for (let i = 0; i < candidates.length; i += 3) {
    const images = await Promise.all(candidates.slice(i, i + 3).map(async ({ thumbnail, original, source }) => {
      for (const url of new Set([thumbnail?.href, original?.href].filter(Boolean))) {
        try {
          const { data } = await axios.get(url, {
            headers: HEADERS, responseType: "arraybuffer", maxRedirects: 0,
            maxContentLength: MAX_DOWNLOAD, signal: AbortSignal.timeout(5_000),
          });
          const image = sharp(data, { limitInputPixels: 12_000_000 });
          const { format } = await image.metadata();
          if (!["jpeg", "png", "webp"].includes(format)) continue;
          const jpeg = await image.rotate().resize(960, 960, { fit: "inside", withoutEnlargement: true })
            .flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
          return { jpeg, source: source.href, hash: createHash("sha256").update(jpeg).digest("hex") };
        } catch { /* Try the original or another result. */ }
      }
      return null;
    }));
    if (images.some(Boolean)) return images.filter(Boolean);
  }
  return [];
}

export async function webImageReferences(queries, video, model, { required = false, notify = required } = {}) {
  if (!queries?.length) return { options: {} };
  const fail = (reason) => {
    if (!required) return notify ? { options: {}, caption: `No web reference used. ${reason}` } : { options: {} };
    throw Object.assign(new Error(reason), { publicMessage: reason });
  };
  const unique = new Map();
  for (const query of queries) {
    const terms = query.replace(/\s+/g, " ").trim().slice(0, 150);
    const key = terms.toLowerCase();
    if (terms && !unique.has(key) && !/https?:\/\/|<@/i.test(terms)) unique.set(key, terms);
  }
  const terms = [...unique.values()].slice(0, MAX_WEB_REFERENCES);
  if (!terms.length) return fail("Use plain search terms for a reference image.");
  const ai = loadConfig().ai;
  const provider = ai?.[video ? ai.video_provider || "openai" : ai.image_provider || "openai"];
  if (h3LabModelId(model || provider?.[video ? "video_model" : "image_model"], video)) {
    return fail("That model doesn't support web references. Try a Flama model.");
  }
  if (active >= 2) return fail("Reference image search is busy. Try again in a moment.");
  active += 1;
  try {
    const selected = [];
    const lookup = async query => {
      const web = await searchImages(query).then(usableImages).catch(() => []);
      return web.length ? web : commonsImages(query).then(usableImages).catch(() => []);
    };
    for (let i = 0; i < terms.length; i += 2) {
      const groups = await Promise.all(terms.slice(i, i + 2).map(lookup));
      for (const group of groups) {
        const match = group.find(image => !selected.some(other => other.source === image.source || other.hash === image.hash));
        if (match) selected.push(match);
      }
    }
    if (!selected.length) return fail("Couldn't find a usable reference image. Try a more specific search.");
    const links = selected.map(image => `<${image.source}>`).join(" · ");
    const note = notify && selected.length < terms.length ? `\nFound ${selected.length} of ${terms.length} requested references.` : "";
    return {
      options: { references: selected.map(image => `data:image/jpeg;base64,${image.jpeg.toString("base64")}`) },
      caption: `Web reference${selected.length === 1 ? "" : "s"}: ${links}${note}`,
    };
  } finally {
    active -= 1;
  }
}
