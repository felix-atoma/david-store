import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

/**
 * Recovery for a locked-out admin, until "Forgot password" by email exists:
 *   pnpm --filter @david-store/api admin:reset-password someone@example.com
 * Sets a random temporary password, signs the account out everywhere and prints the password
 * once. The person should change it in Admin › Settings straight away.
 */
const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2]?.toLowerCase().trim();
  if (!email) throw new Error('Usage: admin:reset-password <email>');

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No account with email ${email}`);
  if (user.role !== Role.SUPER_ADMIN && user.role !== Role.STAFF) throw new Error(`${email} is not an admin account`);

  const password = randomBytes(12).toString('base64url');
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(password, 12), tokenVersion: { increment: 1 }, status: 'ACTIVE' },
  });
  await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await prisma.activityLog.create({ data: { actorId: null, action: 'auth.password.reset-by-script', entityType: 'User', entityId: user.id } });

  console.log(`Temporary password for ${email}: ${password}`);
  console.log('Sign in and change it in Admin › Settings.');
}

main()
  .catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
