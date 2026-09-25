/**
 * fælles. server entry point — production/dev boot.
 * See app.ts for buildApp(), which is what tests use directly.
 */
import { buildApp } from './app';

async function main(): Promise<void> {
  const { app, config } = await buildApp();
  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`fælles. listening on ${config.host}:${config.port} (storage: ${config.storageDir})`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (process.env.VITEST !== 'true') {
  void main();
}

export { buildApp };
