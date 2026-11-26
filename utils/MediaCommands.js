import AIManager from "./AIManager.js";
import { loadConfig, log } from "./functions.js";
import { FLAMA_IMAGE_MODELS, FLAMA_VIDEO_MODELS, H3LAB_IMAGE_MODELS, H3LAB_VIDEO_MODELS,
  h3LabModelId, hasH3LabKey, parseMediaCommand } from "./MediaOptions.js";
import { getDiscordImageUrls } from "./ChatImages.js";
import { videoFailureMessage } from "./VideoErrors.js";
import { deliverMedia } from "./MediaDelivery.js";

const activeUsers = new Set();
const MAX_ACTIVE = 2;
const NO_MENTIONS = { parse: [], repliedUser: false };

export async function handleMediaCommand(message) {
  const match = (message.content || "").trim().match(/^!(imggen|vidgen|modellist)(?=\s|$)\s*([\s\S]*)$/i);
  if (!match) return false;

  const command = match[1].toLowerCase();
  const send = (content) => message.channel.send({ content, allowedMentions: NO_MENTIONS });
  if (command === "modellist") {
    const ai = loadConfig().ai;
    const imageDefault = ai?.[ai.image_provider || "openai"]?.image_model || "nano-banana-2-lite";
    const videoDefault = ai?.[ai.video_provider || "openai"]?.video_model || "gemini-omni-1.2-flash";
    const format = (models, defaultModel) => [...new Set(defaultModel ? [...models, defaultModel] : models)]
      .map((model) => `• \`${model}\`${model === defaultModel ? " **(default)**" : ""}`)
      .join("\n");
    const group = (provider, title, models, defaultModel) => `**${provider} ${title} models**\n${format(models, defaultModel)}`;
    await send([
      group("Flama", "image", FLAMA_IMAGE_MODELS, h3LabModelId(imageDefault, false) ? undefined : imageDefault),
      group("Flama", "video", FLAMA_VIDEO_MODELS, h3LabModelId(videoDefault, true) ? undefined : videoDefault),
      "Use `--model <id>` with `!imggen` or `!vidgen`.",
    ].join("\n\n")).catch(() => {});
    const formatH3 = (models, defaultModel) => models
      .map(model => `• \`${model}\`${model === defaultModel ? " **(default)**" : ""}`).join("\n");
    await send([
      `**h3lab image models**\n${formatH3(H3LAB_IMAGE_MODELS, imageDefault)}`,
      `**h3lab video models**\n${formatH3(H3LAB_VIDEO_MODELS, videoDefault)}`,
      hasH3LabKey() ? "h3lab is configured; provider availability may vary."
        : "To enable h3lab, set `H3LAB_API_KEY` in `.env` and restart.",
    ].join("\n\n")).catch(() => {});
    return true;
  }

  const video = command === "vidgen";
  const kind = video ? "video" : "image";
  const usage = video
    ? "`!vidgen <prompt> [--size 16:9] [--quality 720p] [--duration 5] [--model <id>]`"
    : "`!imggen <prompt> [--size 1:1] [--model <id>]`";

  let request;
  try {
    request = parseMediaCommand(match[2], video);
  } catch (error) {
    await send(`${error.message}\n${usage}`).catch(() => {});
    return true;
  }

  const userId = message.author.id;
  if (activeUsers.has(userId) || activeUsers.size >= MAX_ACTIVE) {
    await send("Media generation is busy. Try again in a bit.").catch(() => {});
    return true;
  }

  activeUsers.add(userId);
  let status;
  let stage = "generate";
  try {
    status = await send(video ? "🎬 Generating your video…" : "🎨 Generating your image…");
    const { prompt, options } = request;
    if (h3LabModelId(options.model, video)) options.referenceUrls = getDiscordImageUrls([message]);
    const media = video
      ? await AIManager.generateVideo(prompt, options)
      : await AIManager.generateImage(prompt, options);
    stage = "upload";
    await deliverMedia({
      media,
      name: `${kind}.${media.extension}`,
      video,
      sendFile: (payload) => message.reply(payload),
      sendLink: (payload) => message.channel.send(payload),
    });
    await status.delete().catch(() => {});
  } catch (error) {
    log(`!${match[1]}: could not ${stage} — ${error.message}`, "warn");
    const note = stage === "upload"
      ? `The ${kind} was generated, but I couldn't deliver it. Try a smaller output.`
      : error.publicMessage || (video ? videoFailureMessage(error) : "Couldn't generate the image. Try a different prompt or model.");
    if (status) await status.edit(note).catch(() => send(note).catch(() => {}));
    else await send(note).catch(() => {});
  } finally {
    activeUsers.delete(userId);
  }
  return true;
}
