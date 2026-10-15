import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    const url = config.get<string>('redisUrl') ?? config.get<string>('REDIS_URL');
    this.client = new Redis(url ?? 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
    this.client.on('error', () => {
      // Swallow transient connection errors; health check reports status.
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      if (this.client.status === 'wait') {
        await this.client.connect();
      }
    } catch {
      // Redis availability is surfaced through /health.
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
