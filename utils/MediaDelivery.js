import { loadConfig } from "./functions.js";
import { mediaModelLabel } from "./MediaOptions.js";

const HOST = "https://litterbox.catbox.moe/resources/internals/api.php";
const MAX_HOST_BYTES = 100 * 1024 * 1024;
const NO_MENTIONS = { parse: [], repliedUser: false };

async function uploadTemporaryFile(media, name) {
  if (media.buffer.length > MAX_HOST_BYTES) throw new Error("File exceeds the temporary upload limit.");
  const form = new FormData();
  form.set("reqtype", "fileupload");
  form.set("time", "1h");
  form.set("fileToUpload", new Blob([media.buffer], { type: media.mime || "application/octet-stream" }), name);
  const response = await fetch(HOST, {
    method: "POST", body: form, redirect: "error", signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Temporary host returned HTTP ${response.status}.`);
  const link = (await response.text()).trim();
  if (!/^https:\/\/litter\.catbox\.moe\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(link)) {
    throw new Error("Temporary host did not return a valid download link.");
  }
  return link;
}

export async function deliverMedia({ media, name, video, sendFile, sendLink = sendFile }) {
  const label = mediaModelLabel(video, media.model);
  const limit = (video ? 25 : 8) * 1024 * 1024;
  let discordError;
  try {
    if (media.buffer.length > limit) throw new Error("File exceeds the Discord upload limit.");
    await sendFile({
      content: label,
      files: [{ attachment: media.buffer, name, description: (media.prompt || "").slice(0, 100) }],
      allowedMentions: NO_MENTIONS,
    });
    return;
  } catch (error) {
    discordError = error;
  }

  if (loadConfig().behavior?.media_host_fallback === false) throw discordError;
  try {
    const link = await uploadTemporaryFile(media, name);
    await sendLink({ content: `${label}\nTemporary download (expires in 1 hour): <${link}>`, allowedMentions: NO_MENTIONS });
  } catch (error) {
    throw new Error(`Media delivery failed — Discord: ${discordError.message}; temporary host: ${error.message}`);
  }
}
