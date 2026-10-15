import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WorkersService } from './jobs/workers.service';

/**
 * Dedicated queue-worker entrypoint: `node dist/worker.js`.
 * Boots the full app context (DB, Redis, FCM) but never listens for HTTP.
 * Run as a separate container/process alongside the API for reliable
 * background delivery on a VPS.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  app.enableShutdownHooks();
  const workers = app.get(WorkersService, { strict: false });
  if (!workers) {
    throw new Error('WorkersService is not available');
  }
  const onSignal = async (): Promise<void> => {
    await app.close();
  };
  process.on('SIGTERM', () => void onSignal());
  process.on('SIGINT', () => void onSignal());
}

void bootstrap();
