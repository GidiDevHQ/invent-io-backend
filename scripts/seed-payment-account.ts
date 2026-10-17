// scripts/seed-payment-account.ts
// Run: npx tsx scripts/seed-payment-account.ts
import 'dotenv/config'; // loads .env (if it's missing: npm i -D dotenv)
import { randomBytes, createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { getPrismaClientClass } from '../src/generated/prisma/client/internal/class';
import { encryptSecret } from '../src/payments/credentials-crypto';

async function main() {
  const orgId = process.env.SEED_ORG_ID; // copy from Prisma Studio > Organization
  const secretKey = process.env.SEED_PAYSTACK_SECRET_KEY;
  if (!orgId || !secretKey) throw new Error('Set SEED_ORG_ID and SEED_PAYSTACK_SECRET_KEY in .env');
  // A test key can't move real money, so a leak is low-impact. Refuse live keys for now.
  if (!secretKey.startsWith('sk_test_')) throw new Error('Test keys only for now');

  const PrismaClient = getPrismaClientClass();
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  // 256 random bits in the URL, unguessable. Only the hash is stored.
  const token = randomBytes(32).toString('base64url');
  // Must match the sha256(token) lookup in WebhookIngestService
  const integrationTokenHash = createHash('sha256').update(token).digest('hex');

  await prisma.paymentAccount.create({
    data: {
      provider: 'PAYSTACK',
      organizationId: orgId,
      integrationTokenHash,
      secretCiphertext: encryptSecret(secretKey), // AES-256-GCM, never plaintext
    },
  });

  const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';
  // Printed once. The raw token is not recoverable from the DB afterwards.
  console.log(`Paste into Paystack test webhook settings:\n${base}/v1/webhooks/paystack/${token}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Error seeding payment account:', error);
  process.exit(1);
});