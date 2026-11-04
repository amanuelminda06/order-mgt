/**
 * Telegram notifications.
 *
 * Hardening applied in this step (does not change route behaviour — the
 * helper already swallowed its own errors):
 *   - JSON.parse is guarded (an HTML/empty response no longer throws inside
 *     the socket callback)
 *   - request timeout added so serverless invocations cannot hang
 * Messages are unchanged, including the legacy hardcoded "ETB".
 */
const https = require('https');
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = require('../config/env');

function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured');
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const postData = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' });
    const url = new URL(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`);

    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        timeout: 5000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.ok) console.log('Telegram sent');
            else console.log('Telegram error:', parsed.description);
          } catch (e) {
            console.log('Telegram error: non-JSON response (status ' + res.statusCode + ')');
          }
          resolve();
        });
      }
    );

    req.on('timeout', () => {
      console.log('Telegram error: timeout');
      req.destroy();
      resolve();
    });
    req.on('error', (e) => {
      console.log('Telegram error:', e.message);
      resolve();
    });
    req.write(postData);
    req.end();
  });
}

module.exports = { sendTelegram };
