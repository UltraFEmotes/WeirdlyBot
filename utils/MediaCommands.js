import AIManager from "./AIManager.js";
import { loadConfig, log } from "./functions.js";
import { IMAGE_MODELS, VIDEO_MODELS, parseMediaCommand } from "./MediaOptions.js";
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
    const format = (models, defaultModel) => [...new Set([...models, defaultModel])]
      .map((model) => `• \`${model}\`${model === defaultModel ? " **(default)**" : ""}`)
      .join("\n");
    await send([
      `**Image models** (\`!imggen\`)\n${format(IMAGE_MODELS, imageDefault)}`,
      `**Video models** (\`!vidgen\`)\n${format(VIDEO_MODELS, videoDefault)}`,
      "Use `--model <id>` to pick one. These are the bot's configured choices; provider availability may vary.",
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
      : video ? videoFailureMessage(error) : "Couldn't generate the image. Try a different prompt or model.";
    if (status) await status.edit(note).catch(() => send(note).catch(() => {}));
    else await send(note).catch(() => {});
  } finally {
    activeUsers.delete(userId);
  }
  return true;
}
