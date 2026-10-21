import 'dotenv/config';
import { EmailChannel } from '../src/notifications/channels/email.channel';

async function main() {
    const to = process.argv[2] ?? 'ndanwemarcel@gmail.com';
    try {
        const result = await new EmailChannel().send({
            to,
            subject: 'Invent-IO test ✅',
            body: 'Your Invent-IO email channel (Brevo) is working.',
        });
        console.log('SENT', JSON.stringify(result));
    } catch (e) {
        console.error('FAILED:', (e as Error).message);
    }
}

void main();
