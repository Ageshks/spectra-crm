import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    const url =
      config.get<string>('databaseUrl') ?? config.get<string>('DATABASE_URL');
    if (!url) {
      throw new Error('DATABASE_URL is not configured');
    }
    super({
      datasources: {
        db: { url },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    // Fail fast when Postgres is unreachable so Docker restarts the container
    // instead of serving a half-initialised API. Retried a few times because
    // the DB can still be starting when the API boots.
    const attempts = Number(process.env.DB_CONNECT_RETRIES ?? 10);
    const delayMs = Number(process.env.DB_CONNECT_DELAY_MS ?? 2000);
    let lastError: unknown;
    for (let i = 1; i <= attempts; i += 1) {
      try {
        await this.$connect();
        await this.$queryRaw`SELECT 1`;
        return;
      } catch (error) {
        lastError = error;
        if (i < attempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Could not connect to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
