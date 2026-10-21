import 'dotenv/config';
import { WhatsAppChannel } from '../src/notifications/channels/whatsapp.channel';

async function main() {
    const to = process.argv[2] ?? '237690075059';
    const body = process.argv[3] ?? 'Invent-IO ✅ — WhatsApp channel works.';
    try {
        const result = await new WhatsAppChannel().send({ to, body });
        console.log('SENT', JSON.stringify(result));
    } catch (e) {
        console.error('FAILED:', (e as Error).message);
    }
}

void main();
