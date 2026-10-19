import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { getPrismaClientClass } from '../src/generated/prisma/client/internal/class';
import { retryFailedOutboxEvent } from '../src/outbox/outbox.publisher';

async function main() {
  const id = process.argv[2];
  const databaseUrl = process.env.DATABASE_URL;
  if (!id) {
    throw new Error('Usage: npm run outbox:retry -- <event-id>');
  }
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const PrismaClient = getPrismaClientClass();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    await retryFailedOutboxEvent(prisma, id);
    console.log(`Outbox event ${id} is eligible for retry.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    `Failed to retry outbox event: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
