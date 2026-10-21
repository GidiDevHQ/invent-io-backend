import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Seeds an org + owner (with a real email) and an unprocessed `payment.confirmed`
 * outbox event, so the running worker will auto-dispatch a notification.
 * Usage: ts-node -T scripts/seed-outbox-event.ts <email>
 */
async function main() {
    const email = process.argv[2] ?? 'ndanwemarcel@gmail.com';
    const prisma = new PrismaService();
    await prisma.onModuleInit();

    const org = await prisma.organization.create({ data: { name: 'Notify Demo' } });
    const branch = await prisma.branch.create({ data: { organizationId: org.id, name: 'Main' } });
    const role = await prisma.role.upsert({
        where: { name: 'OWNER' },
        update: {},
        create: { name: 'OWNER', permissions: ['*'] },
    });

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        user = await prisma.user.create({ data: { name: 'Demo Owner', email, passwordHash: 'x' } });
    }
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, roleId: role.id } });

    await prisma.outboxEvent.create({
        data: {
            type: 'payment.confirmed',
            organizationId: org.id,
            payload: { organizationId: org.id, branchId: branch.id, amountMinor: '250000', currency: 'NGN' },
        },
    });

    console.log(`seeded org=${org.id} owner=${user.email} -> payment.confirmed outbox event`);
    await prisma.onModuleDestroy();
}

void main();
