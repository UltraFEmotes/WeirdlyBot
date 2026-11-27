import assert from "node:assert/strict";
import test from "node:test";
import { discordMediaUrl, hasChatImage, imageSources } from "../utils/ChatImages.js";
import { frameTimes, hasChatVideo } from "../utils/ChatVideo.js";
import { hasChatFile } from "../utils/ChatFiles.js";
import { imageEditSources, refersToRecentImage } from "../utils/ImageEdits.js";
import { extractText } from "../utils/PageReader.js";
import { isPublicAddress, publicHttpsUrl } from "../utils/SafeFetch.js";
import { referenceRoles } from "../utils/WebImageReference.js";

const map = (items) => new Map(items.map((item, i) => [String(i), item]));
const message = ({ attachments = [], embeds = [], stickers = [], ...rest } = {}) =>
  ({ attachments: map(attachments), embeds, stickers: map(stickers), ...rest });

test("isPublicAddress blocks private, loopback and reserved ranges", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) assert.equal(isPublicAddress(ip), true, ip);
});

test("publicHttpsUrl only accepts plain public https URLs", () => {
  assert.ok(publicHttpsUrl("https://example.com/page"));
  for (const url of ["http://example.com", "https://127.0.0.1/", "https://user:pw@example.com", "https://localhost/",
    "https://router.lan/", "https://example.com:8443/", "https://[::1]/"]) assert.equal(publicHttpsUrl(url), null, url);
});

test("extractText keeps article prose and drops page chrome", () => {
  const html = `<html><head><title>T</title><script>evil()</script></head><body>
    <nav>Home About Contact</nav>
    <article><h1>The tower opened in 1889 after two years of construction.</h1>
    <p>It was the tallest man-made structure in the world until 1930, when it was passed.</p>
    <p>Visitors &amp; tourists climb it every day, and the summit is at 330&nbsp;metres.</p>
    ${"<p>Filler sentence that is long enough to count as real prose here.</p>".repeat(6)}</article>
    <footer>Copyright</footer></body></html>`;
  const text = extractText(html);
  assert.match(text, /tallest man-made structure/);
  assert.match(text, /Visitors & tourists/);
  assert.doesNotMatch(text, /evil|Home About|Copyright/);
});

test("imageSources reads attachments, image embeds and stickers but not article previews", () => {
  const msg = message({
    attachments: [{ url: "https://cdn.discordapp.com/attachments/1/2/a.png", name: "a.png", contentType: "image/png" }],
    embeds: [
      { type: "image", thumbnail: { proxyURL: "https://images-ext-1.discordapp.net/external/abc/https/i.imgur.com/x.png", width: 800, height: 600 } },
      { type: "video", thumbnail: { proxyURL: "https://images-ext-1.discordapp.net/external/yt/thumb.jpg" } },
    ],
    stickers: [{ id: "123", name: "wave", format: "PNG" }, { id: "456", name: "anim", format: "LOTTIE" }],
  });
  assert.deepEqual(imageSources(msg).map(source => source.kind), ["attachment", "embed", "sticker"]);
  assert.equal(hasChatImage(message({ embeds: [{ type: "article", thumbnail: { proxyURL: "https://images-ext-1.discordapp.net/external/x" } }] })), false);
  assert.equal(discordMediaUrl("https://evil.example/attachments/x.png"), null);
});

test("videos are treated as vision input, not unreadable files", () => {
  const msg = message({ attachments: [{ url: "https://cdn.discordapp.com/attachments/1/2/clip.mp4", name: "clip.mp4", contentType: "video/mp4" }] });
  assert.equal(hasChatVideo(msg), true);
  assert.equal(hasChatFile(msg), false);
  assert.deepEqual(frameTimes(12, 4), [1.5, 4.5, 7.5, 10.5]);
  assert.deepEqual(frameTimes(2, 6), [0.5, 1.5]);
  assert.deepEqual(frameTimes(0), [0]);
});

test("edits fall back to the bot's most recent generated image only when allowed", () => {
  const botId = "999";
  const generated = message({
    id: "g", author: { id: botId }, createdTimestamp: 1_000, content: "**Image model:** `nano-banana-2-lite`",
    attachments: [{ url: "https://cdn.discordapp.com/attachments/1/2/image.png", name: "image.png", contentType: "image/png" }],
  });
  const channel = { messages: { cache: map([generated]) } };
  const request = message({ id: "r", author: { id: "1" }, content: "make it night time", createdTimestamp: 2_000, channel });
  assert.equal(refersToRecentImage([request]), true);
  assert.deepEqual(imageEditSources([request], [], null, { botId, allowRecent: true }), [generated]);
  assert.deepEqual(imageEditSources([request], [], null, { botId }), []);
  assert.equal(refersToRecentImage([{ content: "change the channel topic to games" }]), false);
});

test("referenceRoles numbers web references after the edit source", () => {
  assert.equal(referenceRoles([]), "");
  assert.match(referenceRoles(["Eiffel Tower"], 1), /image 2 = "Eiffel Tower"/);
});
