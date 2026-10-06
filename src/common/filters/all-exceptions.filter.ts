import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

interface ErrorPayload {
  success: false;
  message: string;
  statusCode: number;
  errors?: unknown;
}

const prismaErrorMap: Record<string, { status: number; message: string }> = {
  P2002: { status: HttpStatus.CONFLICT, message: 'Resource already exists' },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Resource not found' },
  P2003: { status: HttpStatus.BAD_REQUEST, message: 'Related resource constraint violated' },
  P2014: { status: HttpStatus.BAD_REQUEST, message: 'Required relation is missing' },
  P2023: { status: HttpStatus.BAD_REQUEST, message: 'Invalid identifier format' },
};

const fieldFromTarget = (target: unknown): string | undefined => {
  if (Array.isArray(target)) {
    const first = target[0];
    if (typeof first === 'string') return first.split('.')[0];
  }
  return typeof target === 'string' ? target.split('.')[0] : undefined;
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const payload = body as Record<string, unknown>;
        message = typeof payload.message === 'string' ? payload.message : exception.message;
        if (Array.isArray(payload.message)) {
          message = 'Validation failed';
          errors = { fields: payload.message };
        } else if (payload.errors) {
          errors = payload.errors;
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = prismaErrorMap[exception.code];
      status = mapped?.status ?? HttpStatus.INTERNAL_SERVER_ERROR;
      message =
        mapped?.message ??
        (exception.code === 'P2002'
          ? 'Resource already exists'
          : 'Database operation failed');
      if (exception.code === 'P2002') {
        const target = fieldFromTarget(
          (exception.meta as { target?: unknown } | undefined)?.target,
        );
        errors = target ? { field: target } : undefined;
        message = target ? `Duplicate value for ${target}` : message;
      }
      if (exception.code === 'P2003') {
        const fieldName = fieldFromTarget(
          (exception.meta as { field?: unknown } | undefined)?.field,
        );
        errors = fieldName ? { field: fieldName } : undefined;
      }
    } else if (exception instanceof Error) {
      message = 'Internal server error';
      this.logger.error(
        JSON.stringify({
          path: request.url,
          method: request.method,
          name: exception.name,
          detail: exception.message,
        }),
        exception.stack,
      );
    }

    const payload: ErrorPayload = {
      success: false,
      message,
      statusCode: status,
    };
    if (errors) {
      payload.errors = errors;
    }

    if (status >= 500) {
      this.logger.error(
        JSON.stringify({ path: request.url, method: request.method, status, message }),
      );
      // Never leak internal details in production 5xx responses.
      if (process.env.NODE_ENV === 'production') {
        payload.message = 'Internal server error';
        delete payload.errors;
      }
    }

    response.status(status).json(payload);
  }
}
