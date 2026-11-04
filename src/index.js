import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCatalogProxyFetch, loadWebshareProxies } from './catalog-proxy.js';
import { createCatalogService } from './catalog.js';
import { fetchItems } from './vuniper.js';
import { createAccounts } from './accounts.js';
import { createAddonServer } from './server.js';
import { createMetadataService } from './metadata.js';
import { createSettings, createSettingsServer } from './settings.js';
import { createSettingsSecrets } from './settings-secrets.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 7000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const stateDirectory = process.env.STATE_DIRECTORY;
function credentialPath(name) {
  const directory = process.env.CREDENTIALS_DIRECTORY;
  const path = directory && join(directory, name);
  return path && existsSync(path) ? path : undefined;
}

const settingsKey = process.env.SETTINGS_KEY_FILE ?? credentialPath('settings-encryption-key');
if (stateDirectory && !settingsKey) throw new Error('Persistent settings require a settings encryption key.');
const secrets = stateDirectory ? createSettingsSecrets(readFileSync(settingsKey)) : undefined;
const settings = stateDirectory ? createSettings(stateDirectory, secrets) : null;
let config;
let enrichPreviews;
const settingsPassword = credentialPath('settings-password');
const settingsServer = settings && settingsPassword
  ? createSettingsServer(settings, readFileSync(settingsPassword, 'utf8').trim())
  : null;
const accountServices = new Map();
const accounts = settings && process.env.PUBLIC_URL
  ? createAccounts(stateDirectory, process.env.PUBLIC_URL, { secrets })
  : undefined;
await accounts?.migrate();
settingsServer?.on('error', (error) => {
  console.error(`Could not start private settings: ${error.message}`);
});
settingsServer?.listen(7001, '127.0.0.1');
const proxyCredential = credentialPath('catalog-proxy');
const proxyUrls = proxyCredential
  ? readFileSync(proxyCredential, 'utf8').split(/\s+/).filter(Boolean)
  : [];
const webshareCredential = credentialPath('webshare-api-token');
const webshareToken = webshareCredential
  ? readFileSync(webshareCredential, 'utf8').trim()
  : '';
const catalogFetch = proxyUrls.length || webshareToken
  ? createCatalogProxyFetch(proxyUrls, { loadProxies: webshareToken ? () => loadWebshareProxies(webshareToken) : undefined })
  : null;
const service = createCatalogService({
  stateDirectory,
  loadItems: catalogFetch
    ? (section, options) => fetchItems(section, { ...options, fetchImpl: catalogFetch })
    : fetchItems,
});

const server = createAddonServer({
  service,
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
