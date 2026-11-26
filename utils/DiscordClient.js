export function discordMode(config) {
  const mode = config.mode ?? "selfbot";
  if (mode !== "bot" && mode !== "selfbot") throw new Error('Set mode to "bot" or "selfbot" in config.yaml.');
  return mode;
}

export function discordToken(config, mode = discordMode(config)) {
  const settings = config[mode];
  const env = settings?.token_env || (mode === "bot" ? "DISCORD_BOT_TOKEN" : "DISCORD_USER_TOKEN");
  const value = process.env[env] || settings?.token;
  return { token: typeof value === "string" ? value.trim() : "", env };
}

export async function createDiscordClient(config) {
  const mode = discordMode(config);
  if (mode === "bot") {
    const { Client, Events, GatewayIntentBits, Partials } = await import("discord.js");
    return {
      client: new Client({
        intents: [
          GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildVoiceStates,
        ],
        partials: [Partials.Channel],
      }),
      readyEventName: Events.ClientReady,
    };
  }
  const { Client } = await import("@lng2004/discord.js-selfbot-v13");
  return {
    client: new Client({
      checkUpdate: false,
      ws: { properties: { $browser: config.client_properties?.browser || "Discord Client" } },
    }),
    readyEventName: "ready",
  };
}
