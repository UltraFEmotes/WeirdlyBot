import { loadConfig } from "./functions.js";
import { mediaModelLabel } from "./MediaOptions.js";

const CATBOX = "https://catbox.moe/user/api.php";
const LITTERBOX = "https://litterbox.catbox.moe/resources/internals/api.php";
const TMPFILES = "https://tmpfiles.org/api/v1/upload";
const MAX_HOST_BYTES = 100 * 1024 * 1024;
const NO_MENTIONS = { parse: [], repliedUser: false };

export class MediaDeliveryError extends Error {}

async function postFile(host, form, name) {
  const response = await fetch(host, {
    method: "POST", body: form, redirect: "error", signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`${name} returned HTTP ${response.status}.`);
  }
  return response;
}

async function uploadToCatbox(file, name, temporary = false) {
  const form = new FormData();
  form.set("reqtype", "fileupload");
  if (temporary) form.set("time", "1h");
  form.set("fileToUpload", file, name);
  const response = await postFile(temporary ? LITTERBOX : CATBOX, form, temporary ? "Litterbox" : "Catbox");
  const link = (await response.text()).trim();
  const valid = temporary
    ? /^https:\/\/litter\.catbox\.moe\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/
    : /^https:\/\/files\.catbox\.moe\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/;
  if (!valid.test(link)) {
    throw new Error(`${temporary ? "Litterbox" : "Catbox"} did not return a valid download link.`);
  }
  return link;
}

async function uploadToTmpfiles(file, name) {
  const form = new FormData();
  form.set("file", file, name);
  form.set("expire", "3600");
  const response = await postFile(TMPFILES, form, "Tmpfiles");
  const result = await response.json();
  const link = result.status === "success" && new URL(result.data?.url);
  if (!link || !["https:", "http:"].includes(link.protocol) || link.host !== "tmpfiles.org" ||
      link.username || link.password || !/^\/\d+\/[^/<>\s]+$/.test(link.pathname)) {
    throw new Error("Tmpfiles did not return a valid download link.");
  }
  return `https://tmpfiles.org${link.pathname}`;
}

async function uploadHostedFile(media, name) {
  if (media.buffer.length > MAX_HOST_BYTES) throw new Error("File exceeds the external upload limit.");
  const file = new Blob([media.buffer], { type: media.mime || "application/octet-stream" });
  const hosts = [
    { upload: () => uploadToCatbox(file, name), temporary: false },
    { upload: () => uploadToCatbox(file, name, true), temporary: true },
    { upload: () => uploadToTmpfiles(file, name), temporary: true },
  ];
  const errors = [];
  for (const { upload, temporary } of hosts) {
    try {
      return { link: await upload(), temporary };
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(errors.join("; "));
}

export async function deliverMedia({ media, name, video, sendFile, sendLink = sendFile, editFile }) {
  const label = mediaModelLabel(video, media.model);
  const limit = (video ? 25 : 8) * 1024 * 1024;
  const payload = () => ({
    content: label,
    files: [{ attachment: media.buffer, name, description: (media.prompt || "").slice(0, 100) }],
    allowedMentions: NO_MENTIONS,
  });
  let discordError;
  try {
    if (media.buffer.length > limit) throw new Error("File exceeds the Discord upload limit.");
    // editing an existing message (the status) into the delivery keeps
    // slowmode channels to a single send; a failed edit falls back to a send
    if (editFile) {
      try {
        await editFile(payload());
        return { edited: true };
      } catch (error) {
        discordError = error;
      }
    }
    await sendFile(payload());
    return { edited: false };
  } catch (error) {
    discordError = error;
  }

  if (loadConfig().behavior?.media_host_fallback === false) {
    throw new MediaDeliveryError(`Discord upload failed: ${discordError.message}; external hosting is disabled.`);
  }
  try {
    const { link, temporary } = await uploadHostedFile(media, name);
    const caption = temporary ? "Temporary download (expires in 1 hour)" : "Download on Catbox";
    await sendLink({ content: `${label}\n${caption}: <${link}>`, allowedMentions: NO_MENTIONS });
  } catch (error) {
    throw new MediaDeliveryError(`Media delivery failed — Discord: ${discordError.message}; fallback: ${error.message}`);
  }
}
