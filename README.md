# WeirdlyBot

An AI assistant for Discord with image, video, search, and voice tools. Runs as an official Discord bot or, optionally, on a user account.

Official bot mode is recommended. Selfbots violate Discord's Terms of Service and can lead to account termination.

## What it does

- Joins chats in whitelisted servers when messages are **aimed at it** (@ping, reply) **or continue its topic** — a fast relevance judge reads recent context, and the bot goes quiet the moment people drift away. **DMs** always get replies
- Shows a **typing indicator** while thinking, with random reply delays
- Makes occasional **typos** and edits the message a few seconds later to correct them
- Can send **gifs**, **react** to messages, **generate images** (Nano Banana 2 Lite) and **generate videos** (Gemini Omni 1.2 Flash) — the AI invokes these itself
- If someone **attaches an image**, the AI can **edit it** or **animate it into a video** — attachments are **always converted** before use (sharp: decoded, downscaled to ≤1536px, re-encoded as compact JPEG; fallback to Discord's media proxy for conversion), since the video model rejects large references with a generic 400
- The AI picks video length itself (**1-15s**), and shows a **status message** ("generating the image, one sec 🎨") while media renders — deleted when done, turned into a failure note if generation fails
- Media requests retry on HTTP 429/502/503 and retry HTTP 400 once after at least a minute
- If the AI narrates generating media but forgets to invoke the tool, a **fallback intent check** catches the request and generates it anyway (prompt + duration derived from the conversation)
- Keeps per-person conversation history, so follow-ups have context

## Setup

```bash
cp config.yaml.example config.yaml
cp .env.example .env
npm install
```

1. Use Node.js **22.12 or newer**, and set `admin_user_id` to your own Discord user ID in `config.yaml`.
2. Set `FLAMA_API_KEY` in a local, gitignored `.env` file.
3. Choose your Discord connection:
   - **`mode: "bot"`**: Set `DISCORD_BOT_TOKEN` in `.env`. Enable **Message Content Intent** in the Discord Developer Portal and invite the app with the `bot` scope. Give it View Channel, Send Messages, Read Message History, Attach Files, and Add Reactions as needed; add Connect and Speak for voice.
   - **`mode: "selfbot"`**: Use `DISCORD_USER_TOKEN` in `.env`. An existing local `selfbot.token` also works.
4. Start the bot and send `!whitelistserver` in a server from the configured admin account.

```bash
npm start
```

## AI API: Flama

WeirdlyBot uses Flama's OpenAI-compatible API at **`https://ai.tryflama.com/v1`**. This is the base URL already set in `config.yaml.example`:

```yaml
ai:
  openai:
    base_url: "https://ai.tryflama.com/v1"
    api_key_env: "FLAMA_API_KEY"
```

Keep `/v1` in the URL, but don't append an endpoint like `/chat/completions`. WeirdlyBot adds the endpoint for chat, images, or video. Use your own Flama API key in `.env` as `FLAMA_API_KEY`; it is separate from your Discord token.

## Public media commands

Anyone can use these in a whitelisted server or DM, without pinging the AI:

```text
!imggen a cat at a café --size 1:1 --model nano-banana-pro
!vidgen a paper plane gliding through a park --size 16:9 --quality 720p --duration 5 --model gemini-omni-1.2-flash
```

All flags are optional. `--size` is an aspect ratio, `--quality` is video resolution, and `--duration` is 1–15 seconds. The default models are Nano Banana 2 Lite and Gemini Omni 1.2 Flash. Video defaults to 720p; other resolutions and durations depend on model support.

Use `!modellist` to see the bot's image and video model choices and their defaults.

Anyone in a whitelisted server or DM can say `change your status to "Listening to music"` to set the account's custom status text. This doesn't change its online/away setting.

## Admin commands

Only the Discord user configured as `admin_user_id` can use these:

| Command | What it does |
|---|---|
| `!whitelistserver` | Lets the AI talk in the current server |
| `!unwhitelistserver` | Removes the current server from the whitelist |
| `!whitelistservers` | Lists all whitelisted servers |

## Configuration

Everything lives in `config.yaml`:

- `ai` — Flama settings and chat and media models. `openai` is the configuration name for Flama's OpenAI-compatible endpoint.
- `behavior` — reply delays, typo chance, edit delay, message splitting, batching
- `persona` — the bot's name, personality and background

## Keyless search and media

- GIFs come from Wikimedia Commons, no key required.
- Ask the bot to look something up. It searches Wikipedia by default and includes sources. For general web results, set `SEARXNG_URL` in `.env` to the base URL of a SearXNG instance with JSON output enabled. No search API key is needed.
- WeirdlyBot doesn't add watermarks to generated media. Discord uploads include the model ID.
- If Discord can't upload generated media, WeirdlyBot tries Catbox, then Litterbox and Tmpfiles. Catbox links don't automatically expire; the other two expire after an hour. Anyone with the link can download the file. Set `behavior.media_host_fallback: false` to keep media on Discord only.
- The bot can see Discord image attachments on turns it responds to. Ask it to extract text from a screenshot, or reply to the message containing the image. OCR replies skip the bot's typo and message-splitting effects.

## Voice chat

- The same admin who manages the whitelist can use `!joinvc <voice channel ID>` and `!leavevc` in a whitelisted server.
- In the voice channel, each participant must send `!voiceon` in the server to let the bot process their speech. `!voiceoff` or leaving the channel clears their opt-in. Temporary audio is deleted after local transcription; transcripts are sent to Flama for replies.
- Install `ffmpeg` and `whisper.cpp` (`whisper-cli`), then add `WHISPER_MODEL_PATH=/absolute/path/to/ggml-base.bin` to `.env`. Set `WHISPER_CLI` if the executable isn't on your PATH.
- TTS uses Flama and can be configured under `voice` in `config.yaml`. The default `/v1/audio` and `magpie-tts-zeroshot` combination currently returns an upstream 404 in testing, so playback needs a working Flama TTS model.

## How the human-feel works

- Messages are **batched** for ~2.5s, so a burst of messages gets one reply
- A random 0.7–2.5s pause happens before typing starts
- With ~18% chance a word gets a small typo, then the message is **edited to the correct text** 2.5–9s later
- Longer replies are sometimes split into two messages sent a second apart, and the AI can **double-text** on its own — splitting a reply into up to 3 separate messages with natural gaps (`[[br]]` markers)
