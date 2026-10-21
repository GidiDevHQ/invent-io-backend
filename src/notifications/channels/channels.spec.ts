import { WhatsAppChannel } from './whatsapp.channel';
import { EmailChannel } from './email.channel';

const realFetch = global.fetch;
afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
});

describe('WhatsAppChannel', () => {
    it('POSTs a text message to the Graph API and returns the message id', async () => {
        process.env.WHATSAPP_TOKEN = 'tok';
        process.env.WHATSAPP_PHONE_ID = '123';
        process.env.WHATSAPP_API_VERSION = 'v26.0';
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ messages: [{ id: 'wamid.1' }] }),
        });
        global.fetch = fetchMock as never;

        const res = await new WhatsAppChannel().send({ to: '+234', body: 'hi' });

        expect(res.providerMessageId).toBe('wamid.1');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://graph.facebook.com/v26.0/123/messages');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
        expect(JSON.parse(init.body)).toMatchObject({ messaging_product: 'whatsapp', to: '+234', type: 'text' });
    });

    it('throws when not configured', async () => {
        delete process.env.WHATSAPP_TOKEN;
        delete process.env.WHATSAPP_PHONE_ID;
        await expect(new WhatsAppChannel().send({ to: '+1', body: 'x' })).rejects.toThrow(/not configured/);
    });
});

describe('EmailChannel (Brevo)', () => {
    it('POSTs to Brevo with the api-key header', async () => {
        process.env.EMAIL_API_KEY = 'brevo-key';
        process.env.EMAIL_FROM = 'ops@invent-io.example';
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ messageId: 'brevo-1' }),
        });
        global.fetch = fetchMock as never;

        const res = await new EmailChannel().send({ to: 'a@b.com', subject: 'Hi', body: 'hello' });

        expect(res.providerMessageId).toBe('brevo-1');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.brevo.com/v3/smtp/email');
        expect((init.headers as Record<string, string>)['api-key']).toBe('brevo-key');
        expect(JSON.parse(init.body)).toMatchObject({ to: [{ email: 'a@b.com' }], subject: 'Hi' });
    });
});
