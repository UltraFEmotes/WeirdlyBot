# WeirdlyBot

An AI assistant for Discord with image, video, search, and voice tools. Runs as an official Discord bot or, optionally, on a user account.

Official bot mode is recommended. Selfbots violate Discord's Terms of Service and can lead to account termination.

## What it does

- Joins chats in whitelisted servers when messages are **aimed at it** (@ping, reply) **or continue its topic** — a fast relevance judge reads recent context, and the bot goes quiet the moment people drift away. **DMs** always get replies
- Sometimes adds a short, unprompted comment in a whitelisted channel where it recently participated and the same topic is still active. It waits for a pause, never pings or runs tools, and can comment at most once every four minutes per channel. Set `behavior.on_topic_comment_chance: 0` to disable it (default `0.08` per eligible opportunity).
- Shows a **typing indicator** while thinking, with random reply delays
- Makes occasional **typos** and edits the message a few seconds later to correct them
- Can send **gifs**, **react** to messages, **generate images** (Qwen Image 3) and **generate videos** (Gemini Omni 1.2 Flash) — the AI invokes these itself
- If someone **attaches an image**, the AI can **edit it** or **animate it into a video**. For object swaps like “change the baguette to a wrench,” it uses the original attachment, requests the nearest supported aspect ratio, and asks the model to preserve everything outside the edit. Pasted image links (imgur, Tenor, direct image URLs) and stickers count as images too, and “make it night time” right after it generates an image edits that image without needing a reply.
- **Remembers people** long-term: after a few exchanges it keeps short notes about each person (preferred name, interests, upcoming things like an exam date, running jokes), scoped per server and per DM like the shared memory. Anyone can say `!forgetme` to wipe their notes and chat history. Set `behavior.people_memory: false` to disable it. Long chats are summarized instead of forgotten, and the current chat survives a restart.
- **Feels like a regular**: a fuller persona (`persona.opinions`, `likes`, `dislikes`, `quirks`, `example_messages`, `timezone` in `config.yaml`), a mood that changes day to day, matching how the channel types, using the server's custom emoji, replying with just a reaction when that fits, and a filter that removes assistant tells (em dashes, "great question", lists, repeated openers, a question at the end of every message). Replies take about as long as typing them would (`behavior.typing_chars_per_second`, `max_typing_ms`).
- **Notices edits and deletes** of messages it just answered: a real edit gets a reply to the new version, a typo fix is ignored, and a delete sometimes gets a short remark (it never sees or repeats the deleted text).
- **Understands voice messages** by transcribing them locally with whisper.cpp. Set `WHISPER_MODEL_PATH` in `.env` to a ggml model (e.g. `ggml-small.en.bin`); this also enables voice chat transcription.
- **Profile-picture aware**: @mentions show up as names, it can look at someone's pfp ("what's in @sam's pfp"), and images or videos of a person ("draw @sam as a knight", "make a video of me surfing") use their profile picture as a reference. "Make my pfp anime" or "animate @sam's pfp" edits or animates the pfp itself.
- **Understands attached videos** by reading six still frames with `ffmpeg`/`ffprobe` (install them and put them on your PATH, e.g. `brew install ffmpeg`). It can't hear audio. Without ffmpeg, it says it couldn't load the video.
- Tool progress uses reactions instead of filler messages: 🌐 web search, 🎬 video, 🎨 image, 💻 code, 🎞️ GIF lookup, and 🔎 OCR. You can keep chatting while generation runs. If the bot sent a caption for an image or video, it edits that message into the result and replies with just a mention. Without a caption, it sends one final result. Web search doesn’t ping.
- Media requests retry on HTTP 429/502/503 and retry HTTP 400 once after at least a minute
- Respects **slowmode**: the bot waits for the channel cooldown on new messages, including delivery notifications. Reactions and edits don't require another send slot.
- If the AI narrates generating media but forgets to invoke the tool, a **fallback intent check** catches the request and generates it anyway (prompt + duration derived from the conversation)
- Keeps per-person conversation history, so follow-ups have context
- Has **shared memory per server**: what anyone says in one channel (and the bot's replies, last 24h — `behavior.global_memory_hours`) is remembered across that server's channels, so a topic brought up anywhere in the server is known everywhere in it. Each DM conversation keeps its own separate memory, and nothing ever crosses servers or into DMs
- **Catches up before replying**: when it joins a conversation it wasn't part of (or was quiet for), it reads back the channel messages sent since its own last message — so "isn't that right?" makes sense even when it didn't see what came before
- **Knows what you replied to**: replying to one of its messages (no ping needed) or to someone else's message passes the quoted text into the prompt — "do you agree?" works even when the quoted message is hours old
- **Chooses how to reply**: casual chat defaults to a standalone message. The bot can still link a reply when it helps, or ping the requester when asked. Reply to someone and say “AI, answer them” to send the answer directly to their original message. For a two-message request like “hi @Alex” and then “AI say hi to them,” it greets Alex directly, replying to their recent message if available.

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

All flags are optional. `--size` is an aspect ratio, `--quality` is video resolution, and `--duration` is 1–15 seconds. The default models are Qwen Image 3 and Gemini Omni 1.2 Flash. Video defaults to 720p; other resolutions and durations depend on model support.

Use `!modellist` to see the bot's image and video model choices and their defaults.

New images and videos are generated without web references by default. The bot looks them up if you ask, or if you specifically request a faithful depiction of a real-world subject. You can also request separate references explicitly:

```text
!imggen a watercolor of the Sydney Opera House at sunset --ref "Sydney Opera House harbour view"
!vidgen a slow pan up the Eiffel Tower at dawn --duration 5 --ref "Eiffel Tower Champ de Mars" --ref "Eiffel Tower ironwork close-up"
```

The bot searches images via SearXNG (or DDGS without it), then Wikimedia Commons. It downloads the full-size originals when it can (skipping images under 400px), and the chat vision model picks the candidate that actually shows the subject, skipping lookalikes, collages and watermarked stock. Both Flama image and video requests can use up to four distinct references, one per search query, and the bot links the sources it uses. An edit can also add web references after the attached image, e.g. “put my dog next to an accurate Statue of Liberty”. Use public search terms, not private information. If an optional lookup fails, the bot generates normally without adding a warning; explicit requests report missing results.

### Optional h3lab media models

Set `H3LAB_API_KEY` in `.env` and restart to use the additional models listed by `!modellist`. Existing Flama models and defaults are unchanged. For example:

```text
!imggen a forest at sunrise --model flux-2-dev
!vidgen a balloon floating upward --model h3-rio --duration 8
```

Use `h3lab/nano-banana-pro` for the h3lab version; bare `nano-banana-pro` still uses Flama. `h3-rio` accepts 5–10 seconds, and `ltx-distilled` accepts 1–8 seconds and can animate an attached image. These models choose their own video size and quality. For h3lab edits, attach the image in Discord; the bot passes its Discord attachment URL to h3lab.

Anyone in a whitelisted server or DM can say `change your status to "Listening to music"` to set the account's custom status text. This doesn't change its online/away setting.

## Admin commands

Only the Discord user configured as `admin_user_id` can use these:

| Command | What it does |
|---|---|
| `!whitelistserver` | Lets the AI talk in the current server |
| `!unwhitelistserver` | Removes the current server from the whitelist |
| `!whitelistservers` | Lists all whitelisted servers |
| `!silentwhitelist <server id>` | Whitelists a server the account is already in without posting anything there. In a DM it reacts ✅ or ❌. Selfbot mode only |
| DM a server invite | The account joins the server and whitelists it without saying anything; the DM gets a ✅ or ❌ reaction. Selfbot mode only. Discord may ask for a captcha on joins, which makes it fail (❌) — join that one by hand and use `!silentwhitelist` |

## Configuration

Everything lives in `config.yaml`:

- `ai` — Flama settings and chat and media models. `openai` is the configuration name for Flama's OpenAI-compatible endpoint.
- `behavior` — reply delays, typo chance, edit delay, message splitting, batching
- `persona` — the bot's name, personality and background

## Web search

Use `!search <query>` or say `search the web for <query>` in a whitelisted server or DM. WeirdlyBot can also search on its own during chat. It reads the text of the top three result pages (skipping pages that are slow, blocked or need JavaScript), answers with cited sources, and posts numbered source links. Time-sensitive questions also pull dated news results. Results are cached for 10 minutes. If DDGS returns nothing, it falls back to Wikipedia search. If the AI summary fails, it still posts the links.

- **Recommended: self-hosted SearXNG (free, no API key, no quota).** It sends each search to Google, Bing, Brave, DuckDuckGo, Startpage, Yahoo, Wikipedia and more at once, so one engine throttling you doesn't break search, and it powers image search for media references (Google, Bing, Brave, DuckDuckGo, Commons, Unsplash and Flickr images). With Docker (on macOS: `brew install colima docker docker-compose && colima start`), run `searxng/setup.sh`, then set `SEARXNG_URL=http://127.0.0.1:8888` in `.env`. It listens on localhost only and restarts with Docker.
- **Fallback (no setup):** Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and make sure `uv` is on your PATH. WeirdlyBot runs a pinned DDGS search script when SearXNG is unset or unreachable, then falls back to Wikipedia search. To install its dependencies before the first search, run `uv sync --script scripts/web-search.py`.

Queries are sent to the configured search service, so don't include secrets.

## Code generation

Use `!code <prompt>` in a whitelisted server or DM and the AI writes complete, working code. The code is never executed — it is only delivered as a file with the matching extension (`code.py`, `code.js`, `code.cpp`, …).

```text
!code python a snake game with pygame
!code a todo REST API in go --dm
!code --lang rust --dm a cli password generator
```

- `--lang <language>` sets the target language; a leading bare language name (`!code python ...`) or a trailing `dm`/`yes` also work. Without a hint, the language is detected from the generated code.
- `--dm` sends the finished file to your DMs when they are open and falls back to the channel when they are not.
- Generation runs with priority in the background and a 5-minute limit, so long files don't get cut off.

## Media and image reading

- GIFs come from Wikimedia Commons, no key required.
- WeirdlyBot doesn't add watermarks to generated media. Discord uploads include the model ID.
- Reply to one of the bot's generated images or videos with “which model made this?” to look up its delivery label. The bot cannot verify whether an outside upload was AI-generated, or name its model, from appearance alone.
- If Discord can't upload generated media, WeirdlyBot tries Catbox, then Litterbox and Tmpfiles. Catbox links don't automatically expire; the other two expire after an hour. Anyone with the link can download the file. Set `behavior.media_host_fallback: false` to keep media on Discord only.
- The bot can see Discord image attachments on turns it responds to. Ask it to extract text from a screenshot, or reply to the message containing the image. OCR replies skip the bot's typo and message-splitting effects.
- The bot can also read UTF-8 text attachments (source code, logs, Markdown, CSV, JSON, and similar files). Attach one and ask the bot to read it, or reply to a message with a file and address the bot. It reads up to four files (128 KiB per file, with up to 4,000 characters from each sent to the configured AI provider). It never runs the files or saves their contents to conversation memory. PDF, Office documents, archives, and other binary formats aren't supported.

## Voice chat

- The same admin who manages the whitelist can use `!joinvc <voice channel ID>` and `!leavevc` in a whitelisted server.
- In the voice channel, each participant must send `!voiceon` in the server to let the bot process their speech. `!voiceoff` or leaving the channel clears their opt-in. Temporary audio is deleted after local transcription; transcripts are sent to Flama for replies.
- Install `ffmpeg` and `whisper.cpp` (`whisper-cli`), then add `WHISPER_MODEL_PATH=/absolute/path/to/ggml-base.bin` to `.env`. Set `WHISPER_CLI` if the executable isn't on your PATH.
- TTS uses Flama and can be configured under `voice` in `config.yaml`. The default `/v1/audio` and `magpie-tts-zeroshot` combination currently returns an upstream 404 in testing, so playback needs a working Flama TTS model.

## How the human-feel works

- A burst from one person gets **one reply to their last message**. Each new message resets the pause (2.5s of quiet plus a short random delay by default). Discord typing indicators can extend the wait, capped at 20s before the bot starts answering.
- With ~18% chance a word gets a small typo, then the message is **edited to the correct text** 2.5–9s later
- Longer replies are sometimes split into two messages sent a second apart, and the AI can **double-text** on its own — splitting a reply into up to 3 separate messages with natural gaps (`[[br]]` markers)
