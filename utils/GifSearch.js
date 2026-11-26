const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

export async function searchGif(query) {
  const q = query?.trim().replace(/["\\]/g, "").slice(0, 120);
  if (!q) return null;

  const url = new URL(COMMONS_API);
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `${q} filemime:image/gif`,
    gsrnamespace: "6",
    gsrlimit: "8",
    prop: "imageinfo",
    iiprop: "url|mime",
    format: "json",
    formatversion: "2",
  });
  const response = await fetch(url, {
    headers: { "User-Agent": "WeirdlyBot/2.0 (Discord bot)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Wikimedia Commons returned HTTP ${response.status}`);
  const data = await response.json();
  const results = (data.query?.pages || [])
    .map((page) => page.imageinfo?.[0])
    .filter((image) => image?.mime === "image/gif" && /^https:\/\/upload\.wikimedia\.org\//.test(image.url || ""));
  return results.length ? results[Math.floor(Math.random() * results.length)].url : null;
}
