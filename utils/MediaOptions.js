export const IMAGE_MODELS = [
  "nano-banana", "nano-banana-2", "nano-banana-2-lite", "nano-banana-2.1", "nano-banana-pro",
];

export const VIDEO_MODELS = [
  "gemini-omni-1.1-flash", "gemini-omni-1.2-flash", "gemini-omni-flash-preview",
];

export function selectMediaModel(value, video) {
  const model = value?.trim().toLowerCase();
  return (video ? VIDEO_MODELS : IMAGE_MODELS).includes(model) ? model : undefined;
}

export function mediaModelLabel(video, model) {
  const id = typeof model === "string" && /^[\w./:-]{1,150}$/.test(model) ? model : "unknown";
  return `**${video ? "Video" : "Image"} model:** \`${id}\``;
}

export function parseMediaCommand(input, video) {
  const options = video ? { resolution: "720p" } : {};
  const seen = new Set();
  const prompt = input.replace(/(?:^|\s)--([a-z]+)(?:[ \t]*=[ \t]*|[ \t]+(?!-))?([^\s]*)/gi, (_, key, raw) => {
    key = key.toLowerCase();
    const value = raw.toLowerCase();
    if (seen.has(key)) throw new Error(`--${key} can only be used once.`);
    seen.add(key);

    if (key === "model") {
      options.model = selectMediaModel(value, video);
      if (!options.model) throw new Error(`Available models: ${(video ? VIDEO_MODELS : IMAGE_MODELS).join(", ")}.`);
    } else if (key === "size") {
      if (!/^[1-9]\d?:[1-9]\d?$/.test(value)) throw new Error("Use an aspect ratio for --size, e.g. 16:9.");
      options[video ? "aspect" : "size"] = value;
    } else if (video && key === "quality") {
      if (!["480p", "720p", "1080p"].includes(value)) throw new Error("Use 480p, 720p or 1080p for --quality.");
      options.resolution = value;
    } else if (video && key === "duration") {
      const duration = Number(value.replace(/s$/, ""));
      if (!/^\d+s?$/.test(value) || duration < 1 || duration > 15) throw new Error("Use 1–15 seconds for --duration.");
      options.duration = duration;
    } else {
      throw new Error(`Unknown option: --${key}.`);
    }
    return " ";
  }).trim();

  if (!prompt || prompt.length > 16000) throw new Error("Enter a prompt of 1–16,000 characters.");
  return { prompt, options };
}
