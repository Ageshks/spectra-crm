import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context';

/** Stores ip / user-agent for the whole request lifecycle (audit logging). */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
      req.ip ||
      req.socket.remoteAddress;
    RequestContext.run({ ip, userAgent: req.headers['user-agent'] }, next);
  }
}
