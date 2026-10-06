import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';
import { PaginationMeta } from '../utils/pagination.util';

interface WrappedResponse {
  success: boolean;
  message: string;
  data: unknown;
  pagination?: PaginationMeta;
}

interface ServiceResult {
  data: unknown;
  meta?: PaginationMeta;
}

const isServiceResult = (value: unknown): value is ServiceResult =>
  typeof value === 'object' &&
  value !== null &&
  'data' in value &&
  Object.keys(value).length <= 3;

/**
 * Wraps every success payload in the standard envelope:
 * { success, message, data, pagination? }
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<WrappedResponse> {
    const message =
      this.reflector.get<string>(RESPONSE_MESSAGE_KEY, context.getHandler()) ??
      'Success';

    return next.handle().pipe(
      map((payload: unknown) => {
        if (
          payload &&
          typeof payload === 'object' &&
          'success' in payload &&
          'data' in payload
        ) {
          return payload as WrappedResponse;
        }
        if (isServiceResult(payload)) {
          const response: WrappedResponse = { success: true, message, data: payload.data };
          if (payload.meta) {
            response.pagination = payload.meta;
          }
          return response;
        }
        return { success: true, message, data: payload ?? null };
      }),
    );
  }
}
