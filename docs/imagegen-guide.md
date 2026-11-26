# Image Generator Guide

## What is ImageGen?

The `!imggen` command lets you create AI-generated images right in Discord. Describe what you want, and WeirdlyBot sends it back as an attachment.

WeirdlyBot uses Flama's `/v1/images/generations` endpoint with the configured image model. Set `FLAMA_API_KEY` in your environment or local `.env` file.

## Quick Start

The simplest way to use it:

```
!imggen a cute cat
```

That's it! The bot will generate an image of a cute cat for you.

## Basic Usage

### Simple Examples

```
!imggen sunset over mountains
!imggen a dragon breathing fire
!imggen a magical forest
!imggen cyberpunk city at night
```

## Advanced Options

### Image Model

Override the model configured in `config.yaml`:

```
!imggen a lighthouse in watercolor --size 1:1 --model nano-banana-2-lite
```

## Configuration

The provider and default model live in [`config.yaml`](../config.yaml):

```yaml
ai:
  image_provider: "openai"
  openai:
    enabled: true
    api_key_env: "FLAMA_API_KEY"
    base_url: "https://ai.tryflama.com/v1"
    image_model: "nano-banana-2-lite"
```

## Writing Good Prompts

### Be Specific

❌ "car"
✅ "red sports car on highway"

### Add Style

- "anime style magical girl"
- "realistic portrait"
- "cartoon style robot"
- "oil painting of ocean"

### Include Details

- "golden hour lighting"
- "4K quality"
- "dark and moody"
- "bright and cheerful"

## Important Rules

- **Prompt Length**: Keep your description under 500 characters
- **Generation Time**: Images take 5-30 seconds to create
- **File Size**: Images can be up to 8MB (Discord's limit)

## Common Issues

### "Rate limit exceeded"

Wait a few seconds and try again. The API gets busy sometimes.

### "Prompt too long"

Your description is over 500 characters. Make it shorter.

### "Image API error 400"

The model is not offered by the provider. Use `GET /v1/models` and pick one with `"modality": "image"`, or try the default model.

### "Generation failed"

Try a simpler prompt or another `--model`.

### "Request timed out"

The API is very busy. Wait a minute and try again.

## Tips for Better Results

1. **Be descriptive**: Instead of "dog", try "golden retriever puppy playing in grass"
2. **Add art styles**: "anime style", "realistic", "cartoon", "pixel art"
3. **Set the mood**: "dark fantasy", "bright and colorful", "mysterious"
4. **Include lighting**: "sunset lighting", "neon lights", "soft morning light"

## Need Help?

Type `!imggen` without a prompt to see the command syntax in Discord.
