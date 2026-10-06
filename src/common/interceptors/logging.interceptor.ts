import {
  CallHandler,
  ExecutionContext,
  Injectable,
  HttpException,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { throwError } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = Date.now();
    const request = context.switchToHttp().getRequest<{
      method: string;
      path: string;
      route?: { path?: string };
      user?: { id: string };
    }>();
    const { method } = request;
    // Route path avoids writing query-string tokens or other sensitive values.
    const path = request.route?.path ?? request.path;

    return next.handle().pipe(
      tap(() => {
        this.logger.log(
          JSON.stringify({
            method,
            path,
            userId: request.user?.id,
            durationMs: Date.now() - started,
            result: 'ok',
          }),
        );
      }),
      catchError((error: unknown) => {
        const statusCode = error instanceof HttpException ? error.getStatus() : 500;
        this.logger.warn(
          JSON.stringify({
            method,
            path,
            userId: request.user?.id,
            durationMs: Date.now() - started,
            result: 'error',
            statusCode,
          }),
        );
        return throwError(() => error);
      }),
    );
  }
}
