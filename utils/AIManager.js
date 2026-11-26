/**
 * AI MANAGER
 *
 * Centralised manager for the AI providers used to generate chat replies
 * and media:
 * - Groq / Gemini / OpenAI-compatible endpoints from config
 *
 * chainGenerateWithHistory() walks the configured provider chain and falls
 * back to the next provider whenever one fails.
 */

import { log, loadConfig } from "./functions.js";
import Groq from "groq-sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import axios from "axios";
import { videoApiError } from "./VideoErrors.js";
const DEFAULT_IMAGE_MODEL = "nano-banana-2-lite";
const DEFAULT_VIDEO_MODEL = "gemini-omni-1.2-flash";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getApiKey(config) {
  return config?.api_key_env ? process.env[config.api_key_env]?.trim() : config?.api_key;
}

const IMAGE_SIGNATURES = [
  { mime: "image/webp", extension: "webp", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" },
  { mime: "image/png", extension: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", extension: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 },
  { mime: "image/gif", extension: "gif", test: (b) => b.subarray(0, 3).toString("ascii") === "GIF" }
];

function detectImageType(buffer) {
  const match = IMAGE_SIGNATURES.find((signature) => signature.test(buffer));
  return match ? { mime: match.mime, extension: match.extension } : { mime: "image/png", extension: "png" };
}

class AIManager {
  constructor() {
    this.providers = new Map();
    this.models = new Map();
    this.defaultProvider = "openai";
    this.initialized = false;
  }

  /**
   * Initialize all enabled AI providers with API keys from config
   */
  initialize() {
    if (this.initialized) return;

    try {
      const config = loadConfig();
      if (!config.ai) {
        log("No AI configuration found in config.yaml", "warn");
        return;
      }

      this.defaultProvider = config.ai.default_provider || "openai";

      // 1. Groq
      const groqConfig = config.ai.groq;
      if (groqConfig && groqConfig.enabled && groqConfig.api_key) {
        try {
          const client = new Groq({ apiKey: groqConfig.api_key, timeout: 30000 });
          this.providers.set("groq", client);
          this.models.set("groq", groqConfig.model || "llama-3.1-8b-instant");
          log("Groq AI provider initialized (30s timeout)", "info");
        } catch (error) {
          log(`Failed to initialize Groq provider: ${error.message}`, "warn");
        }
      }

      // 2. Gemini
      const geminiConfig = config.ai.gemini;
      if (geminiConfig && geminiConfig.enabled && geminiConfig.api_key) {
        try {
          const client = new GoogleGenAI({ apiKey: geminiConfig.api_key, httpOptions: { timeout: 30000 } });
          this.providers.set("gemini", client);
          this.models.set("gemini", geminiConfig.model || "gemini-2.0-flash");
          log("Google Gemini AI provider initialized (30s timeout)", "info");
        } catch (error) {
          log(`Failed to initialize Google Gemini provider: ${error.message}`, "warn");
        }
      }

      // 3. OpenAI compatible
      const openaiConfig = config.ai.openai;
      const openaiKeyEnv = openaiConfig?.api_key_env;
      const openaiApiKey = getApiKey(openaiConfig);
      if (openaiConfig?.enabled && !openaiApiKey) {
        log(openaiKeyEnv ? `OpenAI compatible provider is missing ${openaiKeyEnv}.` : "OpenAI compatible provider is missing an API key.", "warn");
      }
      if (openaiConfig?.enabled && openaiApiKey) {
        try {
          const client = new OpenAI({
            apiKey: openaiApiKey,
            baseURL: openaiConfig.base_url || "https://api.openai.com/v1",
            timeout: 30000
          });
          this.providers.set("openai", client);
          this.models.set("openai", openaiConfig.model || "gpt-4o");
          log("OpenAI compatible provider initialized (30s timeout)", "info");
        } catch (error) {
          log(`Failed to initialize OpenAI compatible provider: ${error.message}`, "warn");
        }
      }

      this.initialized = true;
      log(`AI Manager initialized. Enabled providers: ${Array.from(this.providers.keys()).join(", ") || "none"}`, "info");
    } catch (error) {
      log(`Error initializing AI Manager: ${error.message}`, "error");
    }
  }

  /**
   * Check if a provider is initialized and ready
   */
  isAvailable(providerName) {
    if (!this.initialized) this.initialize();
    return this.providers.has(providerName);
  }

  /**
   * Get the client instance for a provider
   */
  getClient(providerName) {
    if (!this.initialized) this.initialize();
    return this.providers.get(providerName) || null;
  }

  /**
   * Get the configured model name for a provider
   */
  getModel(providerName) {
    if (!this.initialized) this.initialize();
    return this.models.get(providerName) || null;
  }

  /**
   * Get the default provider name
   */
  getDefaultProvider() {
    if (!this.initialized) this.initialize();
    return this.defaultProvider;
  }

  /**
   * Generate a chat reply, walking the provider chain with fallback.
   * @param {Array<{role:string,content:string|Array}>} messages - Text or OpenAI-style image parts
   * @param {string[]} providerChain
   * @param {Object} [options]
   * @param {number} [options.maxTokens] - cap output tokens (used by the fast relevance judge)
   * @returns {Promise<{text: string, provider: string}>}
   */
  async chainGenerateWithHistory(messages, providerChain, options = {}) {
    if (!this.initialized) this.initialize();
    const errors = [];
    log(`ai chain: trying providers: ${providerChain.join(", ")}`, "debug");

    for (const provider of providerChain) {
      if (!this.isAvailable(provider)) {
        errors.push(`${provider}: not initialized`);
        log(`ai chain: skipping ${provider} (not initialized/enabled)`, "debug");
        continue;
      }

      try {
        log(`ai chain: attempting generation via ${provider}...`, "debug");
        const client = this.getClient(provider);
        const model = this.getModel(provider);
        let text;

        if (provider === "groq" || provider === "openai") {
          const request = { model, messages };
          if (options.maxTokens) request.max_tokens = options.maxTokens;
          const response = await client.chat.completions.create(request);
          text = response.choices[0].message.content;
        } else if (provider === "gemini") {
          const systemMsg = messages.find(m => m.role === "system");
          const systemInstruction = systemMsg ? systemMsg.content : undefined;

          const chatMsgs = messages.filter(m => m.role !== "system");
          const contents = chatMsgs.map(m => {
            const role = m.role === "assistant" ? "model" : "user";
            const parts = typeof m.content === "string" ? [{ text: m.content }] : m.content.flatMap(part => {
              if (part.type === "text") return [{ text: part.text }];
              const image = part.type === "image_url" && part.image_url.url.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
              return image ? [{ inlineData: { mimeType: image[1], data: image[2] } }] : [];
            });
            return { role, parts };
          });

          const requestConfig = {};
          if (systemInstruction) {
            requestConfig.systemInstruction = systemInstruction;
          }
          if (options.maxTokens) {
            requestConfig.maxOutputTokens = options.maxTokens;
          }

          const response = await client.models.generateContent({
            model,
            contents,
            config: requestConfig
          });
          text = response.text;
        } else {
          throw new Error(`Unsupported provider: ${provider}`);
        }

        log(`ai chain: successfully generated via ${provider}`, "debug");
        return { text, provider };
      } catch (err) {
        errors.push(`${provider}: ${err.message}`);
        log(`ai chain: provider "${provider}" failed — ${err.message}`, "warn");
      }
    }

    throw new Error(`All AI providers failed:\n${errors.join("\n")}`);
  }

  /**
   * POST a media job (image/video) with fair-use retry handling.
   * The shared queue answers 429 with a Retry-After header when busy, and
   * 502/503 mean upstream hiccups — those are worth retrying automatically.
   * Retry an ambiguous 400 once after a full minute; invalid requests won't
   * improve with repeated attempts.
   */
  async #postMedia(url, payload, apiKey, timeout, responseType) {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    let lastError = null;
    let retriedBadRequest = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await axios.post(url, payload, { timeout, responseType, headers });
      } catch (error) {
        lastError = error;
        const status = error.response?.status;
        const retryable = (status === 400 && !retriedBadRequest) || status === 429 || status === 502 || status === 503;
        if (!retryable || attempt === 3) break;

        const retryAfter = Number(error.response?.headers?.["retry-after"]);
        const waitMs = status === 400
          ? Math.max(60_000, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0)
          : Math.min(
            30000,
            Math.max(2000, (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 5) * 1000)
          );
        if (status === 400) retriedBadRequest = true;
        log(`media API returned ${status}, retrying in ${Math.ceil(waitMs / 1000)}s (attempt ${attempt + 1}/3)...`, "warn");
        await sleep(waitMs);
      }
    }
    throw lastError;
  }

  /**
   * Generate an image through an OpenAI-compatible /images/generations endpoint.
   * Returns { buffer, mime, extension, model, prompt }.
   */
  async generateImage(prompt, options = {}) {
    if (!this.initialized) this.initialize();

    if (!prompt || !prompt.trim()) {
      throw new Error("An image prompt is required.");
    }

    const config = loadConfig();
    const provider = options.provider || config.ai?.image_provider || "openai";
    const providerConfig = config.ai?.[provider];

    if (!providerConfig) {
      throw new Error(`Image provider "${provider}" not found in config.yaml`);
    }

    const baseUrl = (options.baseUrl || providerConfig.base_url || "").replace(/\/+$/, "");
    const model = options.model || providerConfig.image_model || DEFAULT_IMAGE_MODEL;
    const apiKey = getApiKey(providerConfig);
    if (!baseUrl || !apiKey) throw new Error(`Image provider "${provider}" requires a base URL and API key.`);
    const timeout = options.timeout ?? 180000;

    let response;
    try {
      const payload = { model, prompt: prompt.trim(), n: 1 };
      if (options.size) payload.size = options.size;
      if (options.resolution) payload.resolution = options.resolution;
      if (Array.isArray(options.references) && options.references.length > 0) {
        payload.references = options.references.slice(0, 4);
      }

      response = await this.#postMedia(`${baseUrl}/images/generations`, payload, apiKey, timeout, "json");
    } catch (error) {
      const status = error.response?.status;
      const detail = typeof error.response?.data === "object"
        ? JSON.stringify(error.response.data).slice(0, 300)
        : String(error.response?.data || error.message).slice(0, 300);
      const retryAfter = error.response?.headers?.["retry-after"];
      const retryHint = status === 429 && retryAfter ? ` (retry after ${retryAfter}s)` : "";
      throw new Error(`Image API error ${status || "unknown"}${retryHint}: ${detail}`);
    }

    const item = response.data?.data?.[0];
    if (!item) {
      throw new Error("Image API returned no image data.");
    }

    let buffer;
    if (item.b64_json) {
      buffer = Buffer.from(item.b64_json, "base64");
    } else if (item.url) {
      const imageResponse = await axios.get(item.url, { responseType: "arraybuffer", timeout });
      buffer = Buffer.from(imageResponse.data);
    } else {
      throw new Error("Image API returned neither b64_json nor url.");
    }

    const { mime, extension } = detectImageType(buffer);

    return {
      buffer,
      mime,
      extension,
      model: response.data?.model || model,
      prompt: prompt.trim()
    };
  }

  /**
   * Generate a short video clip through the configured /v1/videos endpoint.
   * The endpoint responds with raw MP4 bytes — JSON only on errors.
   * Video generation can run for tens of seconds, so the timeout is generous.
   * Returns { buffer, mime, extension, model, prompt }.
   */
  async generateVideo(prompt, options = {}) {
    if (!this.initialized) this.initialize();

    if (!prompt || !prompt.trim()) {
      throw new Error("A video prompt is required.");
    }

    const config = loadConfig();
    const provider = options.provider || config.ai?.video_provider || "openai";
    const providerConfig = config.ai?.[provider];

    if (!providerConfig) {
      throw new Error(`Video provider "${provider}" not found in config.yaml`);
    }

    const baseUrl = (options.baseUrl || providerConfig.base_url || "").replace(/\/+$/, "");
    const model = options.model || providerConfig.video_model || DEFAULT_VIDEO_MODEL;
    const apiKey = getApiKey(providerConfig);
    if (!baseUrl || !apiKey) throw new Error(`Video provider "${provider}" requires a base URL and API key.`);
    const timeout = options.timeout ?? 360000;

    let response;
    try {
      const payload = { model, prompt: prompt.trim() };
      if (options.duration) payload.duration = Math.min(60, Math.max(1, Number(options.duration)));
      if (options.aspect) payload.aspect = options.aspect;
      if (options.resolution) payload.resolution = options.resolution;
      if (Array.isArray(options.references) && options.references.length > 0) {
        payload.references = options.references.slice(0, 4);
      }

      response = await this.#postMedia(`${baseUrl}/videos`, payload, apiKey, timeout, "arraybuffer");
    } catch (error) {
      // errors come back as JSON: {"error": {"message", "type", ...}}
      let detail = error.message;
      if (error.response?.data) {
        try {
          const parsed = JSON.parse(Buffer.from(error.response.data).toString("utf8"));
          detail = parsed?.error?.message || JSON.stringify(parsed).slice(0, 300);
        } catch {
          detail = String(error.response.data).slice(0, 300);
        }
      }
      const status = error.response?.status;
      const retryAfter = error.response?.headers?.["retry-after"];
      const retryHint = status === 429 && retryAfter ? ` (retry after ${retryAfter}s)` : "";
      throw videoApiError(status, detail, retryHint);
    }

    // guard against a JSON error body arriving with HTTP 200
    const contentType = String(response.headers?.["content-type"] || "");
    if (contentType.includes("application/json")) {
      let detail = "unknown error";
      try {
        const parsed = JSON.parse(Buffer.from(response.data).toString("utf8"));
        detail = parsed?.error?.message || JSON.stringify(parsed).slice(0, 300);
      } catch {
        // fall through with generic message
      }
      throw videoApiError(response.status, detail);
    }

    const buffer = Buffer.from(response.data);
    if (buffer.subarray(4, 8).toString("ascii") !== "ftyp") {
      throw new Error("The video provider did not return an MP4.");
    }
    return {
      buffer,
      mime: "video/mp4",
      extension: "mp4",
      model: response.headers?.["x-model"] || model,
      prompt: prompt.trim()
    };
  }
}

export default new AIManager();
