/**
 * READY EVENT
 *
 * Fires once when the Discord connection is fully established.
 * Sets the configured status and prints a startup summary.
 */

import chalk from "chalk";
import { log } from "../utils/functions.js";
import { countServers } from "../utils/WhitelistStore.js";
import { discordMode } from "../utils/DiscordClient.js";

export default {
  name: "ready",
  once: true,

  async execute(client) {
    const cfg = client.config;
    const mode = discordMode(cfg);
    const status = cfg[mode]?.status || (mode === "bot" ? "online" : "dnd");

    console.log(chalk.cyan("─".repeat(50)));
    log(`Logged in as ${chalk.cyan(client.user.tag)}`, "success");
    log(`User ID: ${chalk.cyan(client.user.id)}`, "info");
    log(`Status: ${chalk.cyan(status)}`, "info");

    // Set presence — no activity, just a normal looking status
    try {
      client.user.setStatus(status);
      client.user.setActivity(null);
    } catch (error) {
      log(`Failed to set status: ${error.message}`, "warn");
    }

    console.log("");
    log(
      `Chats in ${chalk.cyan(countServers())} whitelisted server(s) + all DMs when messages are aimed at it`,
      "info"
    );
    log("Add a server with: !whitelistserver", "info");
    console.log(chalk.cyan("─".repeat(50)));
    log(`WeirdlyBot is ready (${mode} mode)`, "success");
  },
};
