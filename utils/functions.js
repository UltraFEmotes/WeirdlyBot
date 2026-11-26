/**
 * UTILITY FUNCTIONS
 *
 * Config loading and console logging helpers.
 */

import chalk from "chalk";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let configCache = null;

/**
 * Load and validate configuration from config.yaml (cached).
 */
export function loadConfig(forceReload = false) {
  if (configCache && !forceReload) return configCache;

  try {
    const configPath = path.join(__dirname, "..", "config.yaml");
    if (!fs.existsSync(configPath)) {
      throw new Error(`Configuration file not found at: ${configPath}. Copy config.yaml.example to config.yaml.`);
    }

    const configFile = fs.readFileSync(configPath, "utf8");
    configCache = yaml.load(configFile);

    if (!configCache || typeof configCache !== "object" || Array.isArray(configCache)) {
      throw new Error("Invalid configuration: File is empty or not a valid YAML object");
    }

    return configCache;
  } catch (error) {
    // Use console directly here — log() reads the config and would recurse
    console.error(chalk.red("[CONFIG] Error loading configuration:"), error.message);
    process.exit(1);
  }
}

/**
 * Colored console logger with level filtering for debug messages.
 */
export function log(message, level = "info") {
  const prefixes = {
    info: "[INFO]",
    success: "[ OK ]",
    warn: "[WARN]",
    error: "[ERROR]",
    debug: "[DEBUG]",
  };

  const colors = {
    info: chalk.blue,
    success: chalk.green,
    warn: chalk.yellow,
    error: chalk.red,
    debug: chalk.gray,
  };

  if (level === "debug") {
    let debugEnabled = false;
    try {
      debugEnabled = !!loadConfig().debug_mode?.enabled;
    } catch {
      debugEnabled = false;
    }
    if (!debugEnabled) return;
  }

  const prefix = prefixes[level] || "[LOG]";
  const colorFn = colors[level] || chalk.white;
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${chalk.gray(`[${timestamp}]`)} ${colorFn(`${prefix} ${message}`)}`);
}

/**
 * Clear the console screen in a cross-platform way
 */
export function clearConsole() {
  try {
    const isWin = process.platform === "win32";
    if (isWin) {
      process.stdout.write("\x1Bc");
    } else {
      process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
    }
    if (typeof console.clear === "function") {
      console.clear();
    }
  } catch {
    console.log("\n".repeat(process.stdout.rows || 40));
  }
}

/**
 * Promise-based sleep
 */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
