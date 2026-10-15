import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { RedisService } from '../../common/redis/redis.module';
import { PrismaService } from '../../database/prisma.service';

interface HealthPayload {
  status: 'healthy' | 'degraded';
  database: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
  uptimeSeconds: number;
  timestamp: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness: process is up (used by Docker/K8s). Never touches dependencies. */
  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe (process up)' })
  live(): { status: 'ok'; uptimeSeconds: number; timestamp: string } {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: API + database + Redis (used by load balancers). */
  @Public()
  @Get()
  @ApiOperation({ summary: 'API, database and Redis health status' })
  @ResponseMessage('Health status')
  async check(): Promise<HealthPayload> {
    let database: HealthPayload['database'] = 'disconnected';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'connected';
    } catch {
      database = 'disconnected';
    }
    const redis: HealthPayload['redis'] = (await this.redis.ping())
      ? 'connected'
      : 'disconnected';

    const healthy = database === 'connected' && redis === 'connected';
    const payload: HealthPayload = {
      status: healthy ? 'healthy' : 'degraded',
      database,
      redis,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
    if (!healthy) {
      throw new ServiceUnavailableException(payload);
    }
    return payload;
  }
}
