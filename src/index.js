import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAccounts } from './accounts.js';
import { createAddonServer } from './server.js';
import { createMetadataService } from './metadata.js';
import { createSettings, createSettingsServer } from './settings.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 7000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const settings = process.env.STATE_DIRECTORY ? createSettings(process.env.STATE_DIRECTORY) : null;
let config;
let enrichPreviews;
const settingsServer = settings && process.env.CREDENTIALS_DIRECTORY
  ? createSettingsServer(settings, readFileSync(join(process.env.CREDENTIALS_DIRECTORY, 'settings-password'), 'utf8').trim())
  : null;
settingsServer?.on('error', (error) => {
  console.error(`Could not start private settings: ${error.message}`);
});
settingsServer?.listen(7001, '127.0.0.1');

const accountServices = new Map();
const accounts = settings && process.env.PUBLIC_URL
  ? createAccounts(process.env.STATE_DIRECTORY, process.env.PUBLIC_URL)
  : undefined;
const server = createAddonServer({
  accounts,
  publicUrl: process.env.PUBLIC_URL,
  enrichPreviews(metas, account) {
    if (account) {
      let cached = accountServices.get(account.id);
      if (cached?.revision !== account.revision) {
        cached = { revision: account.revision, enrich: createMetadataService({ settings: account.settings }) };
        accountServices.delete(account.id);
        accountServices.set(account.id, cached);
        if (accountServices.size > 16) accountServices.delete(accountServices.keys().next().value);
      }
      return cached.enrich(metas);
    }
    const current = settings?.get() ?? null;
    if (!enrichPreviews || current !== config) {
      config = current;
      enrichPreviews = createMetadataService({ settings: current ?? { imdb: false } });
    }
    return enrichPreviews(metas);
  },
});
server.on('error', (error) => {
  console.error(`Could not start the add-on: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  const displayHost = host.includes(':') ? `[${host}]` : host;
  console.log(`Vuniper\nInstall in Stremio: http://${displayHost}:${port}/manifest.json`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    settingsServer?.close();
    server.close(() => process.exit(0));
  });
}
