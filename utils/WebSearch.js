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
      }];
    } catch {
      return [];
    }
  }).slice(0, 4);
}

function runKeylessSearch(query) {
  return new Promise((resolve, reject) => {
    const child = execFile("uv", ["run", "--no-project", "--script", SEARCH_SCRIPT], {
      timeout: 25_000, maxBuffer: 64_000,
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

export async function searchWeb(query) {
  const q = query.trim().slice(0, 300);
  if (!q) return [];
  if (activeSearches >= MAX_CONCURRENT_SEARCHES) throw new Error("Web search is busy. Try again in a moment.");
  activeSearches += 1;
  const searxng = process.env.SEARXNG_URL?.trim();
  try {
    if (searxng) {
      const url = new URL(`${searxng.replace(/\/+$/, "")}/search`);
      url.search = new URLSearchParams({ q, format: "json" });
      return formatResults((await fetchJson(url)).results);
    }
    return formatResults(await runKeylessSearch(q));
  } finally {
    activeSearches -= 1;
  }
}
