import 'dotenv/config';
import { EmailChannel } from '../src/notifications/channels/email.channel';
import { renderTemplate } from '../src/notifications/templates';
import { resolveSender, senderForTemplate } from '../src/notifications/sender-identities';

/**
 * Sends one real email per account/notification template to a recipient, each
 * from the sender identity its type maps to. Demonstrates the per-type sender
 * scheme end to end.
 *
 *   npx ts-node -T scripts/send-sample-emails.ts [recipient@example.com]
 */
const SAMPLES: { template: string; data: Record<string, unknown> }[] = [
    { template: 'welcome', data: { name: 'Marcel', businessName: 'Marcel Stores' } },
    { template: 'verify-email', data: { name: 'Marcel', verifyUrl: 'https://app.invent-io.example/verify-email?token=demo' } },
    { template: 'password.reset', data: { resetUrl: 'https://app.invent-io.example/reset-password?token=demo' } },
    { template: 'otp', data: { code: '123456' } },
    { template: 'payment.received', data: { amountMinor: '150000', currency: 'NGN' } },
    { template: 'refund', data: { amountMinor: '50000', currency: 'NGN' } },
    { template: 'settlement.completed', data: { amountMinor: '1250000', currency: 'NGN' } },
    { template: 'weekly.summary', data: { revenue: '4200000', margin: '1600000', currency: 'NGN', topSellers: ['Soap (42)', 'Rice (30)'], lowStock: ['Milk (2)'] } },
    { template: 'membership.invite', data: { orgName: 'Marcel Stores', role: 'cashier', inviteUrl: 'https://app.invent-io.example/invite/demo' } },
];

async function main() {
    const to = process.argv[2] ?? 'ndanwemarcel@gmail.com';
    const channel = new EmailChannel();

    for (const { template, data } of SAMPLES) {
        const senderKey = senderForTemplate(template);
        const from = resolveSender(senderKey);
        const rendered = renderTemplate(template, data);
        try {
            const result = await channel.send({ to, subject: rendered.subject, body: rendered.body, from });
            console.log(`SENT  ${template.padEnd(20)} as ${senderKey.padEnd(8)} <${from.name} ${from.email}>  id=${result.providerMessageId ?? '-'}`);
        } catch (e) {
            console.error(`FAIL  ${template.padEnd(20)} ${(e as Error).message}`);
        }
    }
}

void main();
