const HEADERS = { Accept: "application/json", "User-Agent": "WeirdlyBot/2.0 (Discord bot)" };

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
  return items.flatMap((item) => {
    try {
      const link = new URL(item.url);
      if (link.protocol !== "https:" || link.username || link.password || link.href.length > 400 || /[<>]/.test(link.href)) return [];
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

export async function searchWeb(query) {
  const q = query.trim().slice(0, 300);
  if (!q) return [];

  // Only use an operator-configured instance; don't send private chat queries
  // to arbitrary public instances or let the chat model control the host.
  const searxng = process.env.SEARXNG_URL?.trim();
  if (searxng) {
    const url = new URL(`${searxng.replace(/\/+$/, "")}/search`);
    url.search = new URLSearchParams({ q, format: "json" });
    return formatResults((await fetchJson(url)).results);
  }

  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query", list: "search", srsearch: q, srlimit: "4", format: "json",
  });
  const data = await fetchJson(url);
  return formatResults((data.query?.search || []).map((item) => ({
    ...item,
    url: `https://en.wikipedia.org/?curid=${item.pageid}`,
  })));
}
