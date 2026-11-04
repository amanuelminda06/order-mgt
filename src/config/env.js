/**
 * Central configuration, loaded from environment variables.
 * dotenv is initialised here so any entry point (server.js, scripts, tests)
 * gets the same values.
 */
require('dotenv').config();

const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

module.exports = {
  PORT,
  BASE_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
};
