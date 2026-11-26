export const FLAMA_IMAGE_MODELS = [
  "nano-banana", "nano-banana-2", "nano-banana-2-lite", "nano-banana-2.1", "nano-banana-pro",
];

export const FLAMA_VIDEO_MODELS = [
  "gemini-omni-1.1-flash", "gemini-omni-1.2-flash", "gemini-omni-flash-preview",
];

export const H3LAB_IMAGE_IDS = [
  "flux-2-dev", "flux-3-klein", "qwen-image", "fibo-2-t2i", "anima", "moss-nsfw",
  "qwen-edit-pro", "z-image-turbo", "z-image", "pollinations-flux", "nano-banana-pro",
  "nano-banana-2-1", "flux2-pro", "gpt-image-2.5-flare", "image5", "flux2-klein",
  "image4_ultra", "flux-ultra", "gpt-image-2.5-prism", "gen4", "flux-kontext-max",
  "humain", "ideogram3", "gpt-image-2", "flux-kontext", "qwen-uncensored",
];
export const H3LAB_VIDEO_IDS = ["h3-rio", "ltx-distilled"];
export const H3LAB_IMAGE_MODELS = H3LAB_IMAGE_IDS.map(id => FLAMA_IMAGE_MODELS.includes(id) ? `h3lab/${id}` : id);
export const H3LAB_VIDEO_MODELS = H3LAB_VIDEO_IDS;
export const IMAGE_MODELS = [...FLAMA_IMAGE_MODELS, ...H3LAB_IMAGE_MODELS];
export const VIDEO_MODELS = [...FLAMA_VIDEO_MODELS, ...H3LAB_VIDEO_MODELS];

export function hasH3LabKey() {
  return Boolean(process.env.H3LAB_API_KEY?.trim());
}

export function chatMediaModels(video) {
  return hasH3LabKey() ? (video ? VIDEO_MODELS : IMAGE_MODELS)
    : (video ? FLAMA_VIDEO_MODELS : FLAMA_IMAGE_MODELS);
}

export function h3LabModelId(value, video) {
  if (!value) return undefined;
  const ids = video ? H3LAB_VIDEO_IDS : H3LAB_IMAGE_IDS;
  const flama = video ? FLAMA_VIDEO_MODELS : FLAMA_IMAGE_MODELS;
  if (value.startsWith("h3lab/")) {
    const id = value.slice("h3lab/".length);
    return ids.includes(id) ? id : undefined;
  }
  return !flama.includes(value) && ids.includes(value) ? value : undefined;
}

export function selectMediaModel(value, video) {
  const model = value?.trim().toLowerCase();
  const flama = video ? FLAMA_VIDEO_MODELS : FLAMA_IMAGE_MODELS;
  if (model?.startsWith("flama/") && flama.includes(model.slice(6))) return model.slice(6);
  return flama.includes(model) || h3LabModelId(model, video) ? model : undefined;
}

export function h3VideoDuration(model) {
  return model === "h3-rio" ? { min: 5, max: 10 } : { min: 1, max: 8 };
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
  const h3Model = h3LabModelId(options.model, video);
  if (video && h3Model) {
    const { min, max } = h3VideoDuration(h3Model);
    if (seen.has("quality") || seen.has("size")) throw new Error(`${h3Model} uses its own video size and quality. Omit those flags.`);
    if (options.duration != null && (options.duration < min || options.duration > max)) {
      throw new Error(`${h3Model} supports ${min}–${max} seconds.`);
    }
  }
  return { prompt, options };
}
