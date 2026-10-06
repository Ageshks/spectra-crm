import { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  customerId?: string;
  employeeId?: string;
  managerId?: string;
}

export interface RequestContextInfo {
  ip?: string;
  userAgent?: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  type: 'access';
}
