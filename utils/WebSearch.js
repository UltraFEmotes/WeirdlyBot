import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const HEADERS = { Accept: "application/json", "User-Agent": "WeirdlyBot/2.0 (Discord bot)" };
const SEARCH_SCRIPT = fileURLToPath(new URL("../scripts/web-search.py", import.meta.url));
const MAX_CONCURRENT_SEARCHES = 3;
const RUNNER_ENV = new Set(["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "TMP", "TEMP", "TMPDIR",
  "LOCALAPPDATA", "APPDATA", "XDG_CACHE_HOME", "UV_CACHE_DIR", "SSL_CERT_FILE", "SSL_CERT_DIR"]);
let activeSearches = 0;

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: HEADERS,
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Search returned HTTP ${response.status}`);
  return response.json();
}

function formatResults(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.flatMap((item) => {
    try {
      const link = new URL(item.url);
      if (link.protocol !== "https:" || link.username || link.password || link.href.length > 400 ||
          /[<>]/.test(link.href) || seen.has(link.href)) return [];
      seen.add(link.href);
      return [{
        url: link.href,
        title: String(item.title || "").slice(0, 180),
        snippet: String(item.content || item.snippet || "").replace(/<[^>]*>/g, "").slice(0, 500),
        ...(item.date || item.publishedDate ? { date: String(item.date || item.publishedDate).slice(0, 40) } : {}),
      }];
    } catch {
      return [];
    }
  });
}

// Keep at most two results per site so one domain can't crowd out the rest.
function diverse(results, limit) {
  const perHost = new Map();
  return results.filter(({ url }) => {
    const host = new URL(url).hostname.replace(/^www\./, "");
    perHost.set(host, (perHost.get(host) || 0) + 1);
    return perHost.get(host) <= 2;
  }).slice(0, limit);
}

const TIME_SENSITIVE = /\b(?:today|tonight|yesterday|tomorrow|this (?:week|month|year)|latest|recent(?:ly)?|current(?:ly)?|right now|news|breaking|update[sd]?|score|won|results?|released?|announced?|price|stock|election|20[2-3]\d)\b/i;
const CACHE_MS = 10 * 60_000;
const cache = new Map();

function cached(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  cache.delete(key);
  return undefined;
}

function remember(key, value) {
  // Empty results are usually a flaky backend, not a real answer.
  if (!value?.length) return value;
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}

function runKeylessSearch(query, mode) {
  return new Promise((resolve, reject) => {
    const child = execFile("uv", ["run", "--no-project", "--script", SEARCH_SCRIPT, ...(mode ? [mode] : [])], {
      timeout: mode === "images" ? 10_000 : 25_000, maxBuffer: 64_000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => RUNNER_ENV.has(key.toUpperCase()))),
    }, (error, stdout) => {
      if (error) {
        if (error.code === "ENOENT") reject(new Error("Keyless web search requires uv, or a configured SEARXNG_URL."));
        else reject(new Error(error.killed ? "The search timed out." : "The keyless search providers did not respond."));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error("The keyless search returned invalid results."));
      }
    });
    child.stdin.on("error", () => {}); // The search runner may exit before reading stdin.
    child.stdin.end(query);
  });
}

function searxngUrl() {
  return process.env.SEARXNG_URL?.trim().replace(/\/+$/, "") || null;
}

async function searxng(q, category) {
  const url = new URL(`${searxngUrl()}/search`);
  url.search = new URLSearchParams({ q, format: "json", categories: category });
  return (await fetchJson(url)).results || [];
}

// "1920x1080" / "1920 × 1080" → { width, height }
function resolution(value) {
  const match = String(value || "").match(/(\d+)\s*[x×]\s*(\d+)/);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : {};
}

/**
 * Image search for media references: SearXNG first (Google, Bing, Brave,
 * DuckDuckGo, Commons, Unsplash and Flickr images at once), then DDGS.
 * @returns {Promise<{ thumbnail: string, original: string, url: string, title: string, width?: number, height?: number }[]>}
 */
export async function searchImages(query) {
  const key = `images:${query.trim().toLowerCase()}`;
  const hit = cached(key);
  if (hit) return hit;
  if (activeSearches >= MAX_CONCURRENT_SEARCHES) throw new Error("Web search is busy.");
  activeSearches += 1;
  try {
    if (searxngUrl()) {
      const results = await searxng(query, "images").catch(() => []);
      const images = results.filter(item => item.img_src && item.url).slice(0, 10).map(item => ({
        thumbnail: item.thumbnail_src || "", original: item.img_src, url: item.url,
        title: String(item.title || "").slice(0, 180), ...resolution(item.resolution),
      }));
      if (images.length) return remember(key, images);
    }
    return remember(key, await runKeylessSearch(query, "images"));
  } finally {
    activeSearches -= 1;
  }
}

// Keyless and rate-limit friendly, so it backs up the scraped DDGS search
// when every engine comes back empty or blocked.
async function wikipediaSearch(q) {
  const url = new URL("https://en.wikipedia.org/w/rest.php/v1/search/page");
  url.search = new URLSearchParams({ q, limit: "5" });
  const { pages } = await fetchJson(url);
  return formatResults((pages || []).map(page => ({
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.key)}`,
    title: page.title,
    snippet: [page.description, page.excerpt].filter(Boolean).join(" — "),
  })));
}

/**
 * Search the web. Time-sensitive questions also pull news results, which
 * carry publish dates. Results are cached for ten minutes.
 * @returns {Promise<{ url: string, title: string, snippet: string, date?: string }[]>}
 */
export async function searchWeb(query, { limit = 6 } = {}) {
  const q = query.trim().slice(0, 300);
  if (!q) return [];
  const key = `web:${q.toLowerCase()}`;
  const hit = cached(key);
  if (hit) return hit.slice(0, limit);
  if (activeSearches >= MAX_CONCURRENT_SEARCHES) throw new Error("Web search is busy. Try again in a moment.");
  activeSearches += 1;
  const fresh = TIME_SENSITIVE.test(q);
  try {
    // SearXNG (self-hosted, no quota) → DDGS (scraped) → Wikipedia.
    let web = { error: new Error("No search backend configured.") };
    let news = [];
    if (searxngUrl()) {
      [web, news] = await Promise.all([
        searxng(q, "general").then(formatResults).catch(error => ({ error })),
        fresh ? searxng(q, "news").then(formatResults).catch(() => []) : [],
      ]);
    }
    if (web.error || !web.length) {
      [web, news] = await Promise.all([
        runKeylessSearch(q).then(formatResults).catch(error => ({ error })),
        fresh && !news.length ? runKeylessSearch(q, "news").then(formatResults).catch(() => []) : news,
      ]);
    }
    if (web.error || !web.length) {
      const fallback = await wikipediaSearch(q).catch(() => []);
      if (web.error && !fallback.length && !news.length) throw web.error;
      web = fallback;
    }
    // Interleave so fresh news sits near the top without burying the web hits.
    let results = [];
    for (let i = 0; i < Math.max(web.length, news.length); i++) results.push(...[news[i], web[i]].filter(Boolean));
    results = results.filter((item, i) => results.findIndex(other => other.url === item.url) === i);
    return remember(key, diverse(results, 10)).slice(0, limit);
  } finally {
    activeSearches -= 1;
  }
}
