import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import axios from "axios";

const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; WeirdlyBot/2.0; +https://github.com/UltraFEmotes/WeirdlyBot)" };

// Public internet only: search results and image originals point at arbitrary
// hosts, so block anything that resolves to a private, loopback or reserved range.
export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
  }
  if (family === 6) {
    const ip = address.toLowerCase();
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    return !(ip === "::" || ip === "::1" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || /^ff/.test(ip) ||
      ip.startsWith("64:ff9b:") || ip.startsWith("2001:db8:"));
  }
  return false;
}

// Validating inside the socket's own lookup means a DNS rebind between check
// and connect can't slip through.
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const usable = addresses.filter(({ address }) => isPublicAddress(address));
    if (!usable.length || usable.length !== addresses.length) {
      return callback(Object.assign(new Error(`Blocked non-public address for ${hostname}`), { code: "EBLOCKED" }));
    }
    if (options.all) callback(null, usable);
    else callback(null, usable[0].address, usable[0].family);
  });
}

const agent = new https.Agent({ lookup: publicLookup, keepAlive: false });

export function publicHttpsUrl(value, maxLength = 1500) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
        url.href.length > maxLength || /[<>]/.test(url.href)) return null;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && !isPublicAddress(host)) return null;
    if (/^(?:localhost|.*\.(?:local|internal|localhost|lan|home|arpa))$/i.test(host)) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * GET a public https URL with a byte cap. Redirects are followed (max 3) only
 * to other public https URLs.
 * @returns {Promise<{ data: Buffer, contentType: string, url: string }>}
 */
export async function safeGet(value, { maxBytes = 2 * 1024 * 1024, timeoutMs = 6_000, accept } = {}) {
  const url = publicHttpsUrl(value);
  if (!url) throw new Error("Not a public https URL");
  const response = await axios.get(url.href, {
    headers: { ...HEADERS, ...(accept ? { Accept: accept } : {}) },
    httpsAgent: agent,
    responseType: "arraybuffer",
    maxContentLength: maxBytes,
    maxRedirects: 3,
    beforeRedirect: (options) => {
      const href = options.href || `${options.protocol}//${options.hostname}${options.path || ""}`;
      if (options.protocol !== "https:" || !publicHttpsUrl(href)) throw new Error("Blocked redirect");
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return {
    data: Buffer.from(response.data),
    contentType: String(response.headers["content-type"] || ""),
    url: response.request?.res?.responseUrl || url.href,
  };
}
