import { User } from '@prisma/client';

export interface SafeUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: User['role'];
  profilePhoto: string | null;
  isActive: boolean;
  isVerified: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Strips sensitive fields — the only sanctioned way to serialize a User. */
export const pickUser = (user: User): SafeUser => ({
  id: user.id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  phone: user.phone,
  role: user.role,
  profilePhoto: user.profilePhoto,
  isActive: user.isActive,
  isVerified: user.isVerified,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});
