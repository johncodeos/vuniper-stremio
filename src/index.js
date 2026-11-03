import { createAddonServer } from './server.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 7000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const server = createAddonServer({ publicUrl: process.env.PUBLIC_URL });
server.on('error', (error) => {
  console.error(`Could not start the add-on: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  const displayHost = host.includes(':') ? `[${host}]` : host;
  console.log(`Vuniper\nInstall in Stremio: http://${displayHost}:${port}/manifest.json`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
