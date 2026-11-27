import AIManager from "./AIManager.js";
import { loadConfig, log } from "./functions.js";
import { IMAGE_MODELS, VIDEO_MODELS, h3LabModelId, hasH3LabKey, parseMediaCommand } from "./MediaOptions.js";
import { getDiscordImageUrls } from "./ChatImages.js";
import { videoFailureMessage } from "./VideoErrors.js";
import { deliverMedia } from "./MediaDelivery.js";
import { pacedSend } from "./SlowMode.js";
import { webImageReferences } from "./WebImageReference.js";
import { reactForTool, toolReply } from "./ToolFeedback.js";

const activeUsers = new Set();
const MAX_ACTIVE = 2;
const NO_MENTIONS = { parse: [], repliedUser: false };

export async function handleMediaCommand(message) {
  const match = (message.content || "").trim().match(/^!(imggen|vidgen|modellist)(?=\s|$)\s*([\s\S]*)$/i);
  if (!match) return false;

  const command = match[1].toLowerCase();
  const send = (content) => pacedSend(message.channel, () => message.channel.send({ content, allowedMentions: NO_MENTIONS }));
  if (command === "modellist") {
    const ai = loadConfig().ai;
    const imageDefault = ai?.[ai.image_provider || "openai"]?.image_model || "qwen-image-3";
    const videoDefault = ai?.[ai.video_provider || "openai"]?.video_model || "gemini-omni-1.2-flash";
    const format = (models, defaultModel) => [...new Set(defaultModel ? [...models, defaultModel] : models)]
      .map((model) => `• \`${model}\`${model === defaultModel ? " **(default)**" : ""}`)
      .join("\n");
    await send([
      `**Image models** (\`!imggen\`)\n${format(IMAGE_MODELS, imageDefault)}`,
      `**Video models** (\`!vidgen\`)\n${format(VIDEO_MODELS, videoDefault)}`,
      "Use `--model <id>` with `!imggen` or `!vidgen`.",
      ...(!hasH3LabKey() ? ["H3Lab models are temporarily disabled."] : []),
    ].join("\n\n")).catch(() => {});
    return true;
  }

  const video = command === "vidgen";
  const kind = video ? "video" : "image";
  const usage = video
    ? '`!vidgen <prompt> [--size 16:9] [--quality 720p] [--duration 5] [--model <id>] [--ref "search terms"]`'
    : '`!imggen <prompt> [--size 1:1] [--model <id>] [--ref "search terms"]`';

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
  let stage = "generate";
  try {
    await reactForTool(message, kind);
    const { prompt, options: { webReferences, ...options } } = request;
    if (h3LabModelId(options.model, video)) options.referenceUrls = getDiscordImageUrls([message]);
    const reference = await webImageReferences(webReferences, video, options.model, { required: true });
    Object.assign(options, reference.options);
    const media = video
      ? await AIManager.generateVideo(prompt, options)
      : await AIManager.generateImage(prompt, options);
    stage = "upload";
    await deliverMedia({
      media: { ...media, referenceCaption: reference.caption },
      name: `${kind}.${media.extension}`,
      video,
      sendFile: (payload) => toolReply(message, payload, { ping: true }),
    });
  } catch (error) {
    log(`!${match[1]}: could not ${stage} — ${error.message}`, "warn");
    const note = stage === "upload"
      ? `The ${kind} was generated, but I couldn't deliver it. Try a smaller output.`
      : error.publicMessage || (video ? videoFailureMessage(error) : "Couldn't generate the image. Try a different prompt or model.");
    await toolReply(message, { content: note }).catch(() => {});
  } finally {
    activeUsers.delete(userId);
  }
  return true;
}
