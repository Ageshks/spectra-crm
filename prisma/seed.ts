import { PrismaClient, Role } from '@prisma/client';
import argon2 from 'argon2';

/**
 * Minimal production seed: creates (or reuses) an admin + employee + customer
 * demo graph. Safe to re-run — uses upserts keyed on email.
 * Controlled by SEED_* env vars; never bakes credentials into the image.
 */
const prisma = new PrismaClient();
const DEFAULT_DESIGNATIONS = [
  'Field Worker',
  'Field Technician',
  'Temp Staff',
  'Office Staff',
  'Supervisor',
  'Manager',
  'Admin',
];

const first = (names: string[], fallback: string): string => {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return fallback;
};

async function main(): Promise<void> {
  for (const name of DEFAULT_DESIGNATIONS) {
    const isFieldAppEligible = ['Field Technician', 'Temp Staff'].includes(name);
    const existing = await prisma.designation.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      await prisma.designation.update({
        where: { id: existing.id },
        data: { canUseFieldApp: isFieldAppEligible },
      });
    } else {
      await prisma.designation.create({ data: { name, canUseFieldApp: isFieldAppEligible } });
    }
  }

  const adminEmail = first(['SEED_ADMIN_EMAIL'], 'admin@example.com').toLowerCase();
  const adminPassword = first(['SEED_ADMIN_PASSWORD'], 'ChangeMe123!');
  const adminFirst = first(['SEED_ADMIN_FIRST_NAME'], 'Site');
  const adminLast = first(['SEED_ADMIN_LAST_NAME'], 'Admin');

  const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: Role.ADMIN, isActive: true },
    create: {
      firstName: adminFirst,
      lastName: adminLast,
      email: adminEmail,
      passwordHash,
      role: Role.ADMIN,
      isActive: true,
      isVerified: true,
    },
  });
  console.log(`Seeded admin: ${admin.email} (${admin.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
