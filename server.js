/**
 * Entry point.
 *
 * All application logic lives in src/. This file only loads config, builds
 * the app and (outside Vercel) starts listening. It exports the app so
 * tests can bind an ephemeral port.
 */
require('./src/config/env');

const createApp = require('./src/app');
const { PORT } = require('./src/config/env');

const app = createApp();

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Cupcake Delights running on http://localhost:${PORT}`);
    console.log(`Telegram: ${process.env.TELEGRAM_BOT_TOKEN ? 'Configured' : 'Not configured'}`);
  });
}

module.exports = app;
