/**
 * WEIRDLYBOT — DISCORD AI
 *
 * An AI that chats on your behalf like a real person:
 * - chats in whitelisted servers and DMs
 * - typing indicator while thinking, random reply delays
 * - occasional typos that get corrected by editing the message later
 * - sends gifs, reacts to messages, generates images (AI-invoked tools)
 *
 * Admin commands (owner user id only):
 * - !whitelistserver / !unwhitelistserver / !whitelistservers
 *
 * WARNING: Selfbots violate Discord's Terms of Service
 * Use at your own risk - accounts may be terminated
 *
 * @author faiz4sure
 * @version 2.0.0
 */

import chalk from "chalk";
import figlet from "figlet";
import gradient from "gradient-string";

import readyEvent from "./events/ready.js";
import messageCreateEvent, { onChatTyping } from "./events/messageCreate.js";
import AIManager from "./utils/AIManager.js";
import { createDiscordClient, discordMode, discordToken } from "./utils/DiscordClient.js";
import { onVoiceStateUpdate, stopVoiceChat } from "./utils/VoiceChat.js";
import { configure as configureEngagement } from "./utils/EngagementManager.js";
import { loadConfig, log, wait, clearConsole } from "./utils/functions.js";

// Global state for graceful shutdown
let isShuttingDown = false;
let client = null;

/**
 * Display a fancy ASCII art banner with gradient colors
 */
function displayBanner(mode) {
  try {
    const coolGradient = gradient(["#00FFFF", "#0099FF", "#0033FF", "#0000FF"]);
    const asciiArt = figlet.textSync("WeirdlyBot", {
      font: "Standard",
      horizontalLayout: "default",
      verticalLayout: "default",
      width: 80,
      whitespaceBreak: true,
    });

    console.log("\n");
    console.log(coolGradient(asciiArt));
    console.log("\n");
    console.log(chalk.cyan("> ") + chalk.gray("an ai that chats like a real person"));
    console.log(chalk.cyan("> ") + chalk.gray(`Discord mode: ${mode}`));
    if (mode === "selfbot") console.log(chalk.yellow("> Selfbots violate Discord's Terms of Service"));
    console.log("\n");
  } catch {
    console.log("\n" + chalk.cyan("=".repeat(50)));
    console.log(chalk.cyan("                     WEIRDLYBOT"));
    console.log(chalk.cyan("=".repeat(50)) + "\n");
  }
}

/**
 * Catch missing or placeholder tokens without printing credentials.
 */
function validateToken(token) {
  if (!token) {
    return { isValid: false, error: "No token provided for the selected Discord mode." };
  }
  if (typeof token !== "string") {
    return { isValid: false, error: "Token must be a string. Check your config.yaml format." };
  }
  if (!token.trim()) {
    return { isValid: false, error: "Token is empty. Please provide a valid Discord token." };
  }
  if (token.length < 50) {
    return { isValid: false, error: "Token appears to be too short. Discord tokens are typically 59+ characters." };
  }

  const placeholders = ["YOUR_TOKEN_HERE", "DISCORD_TOKEN", "TOKEN", "your_token", "paste_token_here", "YOUR_DISCORD_TOKEN"];
  if (placeholders.some((p) => token.toLowerCase().includes(p.toLowerCase()))) {
    return { isValid: false, error: "Token appears to be a placeholder. Please replace it with your actual Discord token." };
  }
  if (!token.includes(".")) {
    return { isValid: false, error: "Token format appears invalid. Discord tokens typically contain dots (.)." };
  }

  return { isValid: true, error: null };
}

/**
 * Keep the process alive through unexpected errors instead of crashing
 */
function setupProcessGuards() {
  process.on("uncaughtException", (error) => {
    log(`Uncaught exception: ${error.message}`, "error");
  });
  process.on("unhandledRejection", (reason) => {
    log(`Unhandled rejection: ${reason?.message ?? reason}`, "error");
  });
}

/**
 * Graceful shutdown on Ctrl+C / kill
 */
function setupSignalHandlers() {
  const shutdown = (signal, exitCode = 0) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log(`Received ${signal}, shutting down...`, "warn");
    try {
      stopVoiceChat();
      if (client) client.destroy();
    } catch {
      // ignore cleanup errors
    }
    setTimeout(() => process.exit(exitCode), 100);
  };

  process.on("SIGINT", () => shutdown("SIGINT", 0));
  process.on("SIGTERM", () => shutdown("SIGTERM", 0));
}

/**
 * Main startup: load config, validate token, register events, login.
 */
async function initialize() {
  try {
    log("Loading configuration...", "info");
    const config = loadConfig();
    const mode = discordMode(config);
    const { token, env } = discordToken(config, mode);

    log("Initializing AI Manager...", "info");
    AIManager.initialize();

    configureEngagement(config.behavior?.engagement_timeout_minutes ?? 10);

    log("Validating Discord token...", "info");
    const validation = validateToken(token);
    if (!validation.isValid) {
      console.error(chalk.red("\n[TOKEN ERROR] " + validation.error));
      console.error(chalk.yellow("\nHow to fix:"));
      console.error(chalk.yellow(`Set ${env} in .env or configure ${mode}.token in your local config.yaml.`));
      console.error(chalk.red("\nWARNING: Never share your token with anyone!\n"));
      process.exit(1);
    }

    log("Initializing Discord client...", "info");
    const discord = await createDiscordClient(config);
    client = discord.client;
    client.config = config;

    client.once(discord.readyEventName, () => readyEvent.execute(client));
    client.on(messageCreateEvent.name, (...args) => messageCreateEvent.execute(client, ...args));
    client.on("typingStart", (typing) => onChatTyping(client, typing));
    client.on("voiceStateUpdate", onVoiceStateUpdate);

    setupProcessGuards();
    setupSignalHandlers();

    await wait(600);
    try {
      clearConsole();
    } catch {
      console.log("\n".repeat(10));
    }
    displayBanner(mode);

    log("Connecting to Discord...", "info");
    try {
      await client.login(token);
      log("Connected to Discord!", "success");
    } catch (loginError) {
      if (loginError.message.includes("TOKEN_INVALID")) {
        console.error(chalk.red("\n[LOGIN ERROR] Invalid Discord token"));
        console.error(chalk.yellow("Your token may be expired, revoked or incorrectly copied."));
        console.error(chalk.yellow("Get a fresh token and update config.yaml"));
      } else if (loginError.message.includes("RATE_LIMITED")) {
        console.error(chalk.red("\n[LOGIN ERROR] Rate limited by Discord"));
        console.error(chalk.yellow("Please wait a few minutes before trying again"));
      } else {
        console.error(chalk.red("\n[LOGIN ERROR] Failed to connect to Discord"));
        console.error(chalk.yellow("Error details: " + loginError.message));
      }
      console.error(chalk.red("\nBot startup failed. Please check your configuration.\n"));
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red("\n[FATAL ERROR] " + error.message));
    if (error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

log("Starting WeirdlyBot...", "info");
initialize().catch((error) => {
  console.error(chalk.red("\n[FATAL ERROR] WeirdlyBot failed to start:"));
  console.error(chalk.red(error.message));
  process.exit(1);
});
