import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Allows public requests while populating a user when a valid bearer token is supplied. */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>();
    if (!request.headers.authorization) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser>(error: Error | null, user: TUser): TUser {
    if (error || !user) throw error ?? new UnauthorizedException('Invalid or expired access token');
    return user;
  }
}
