import { resolveSender, senderForTemplate } from './sender-identities';

describe('sender identities', () => {
    const OLD_ENV = process.env;
    beforeEach(() => {
        process.env = { ...OLD_ENV };
        delete process.env.EMAIL_FROM_DOMAIN;
        delete process.env.EMAIL_FROM;
        delete process.env.EMAIL_FROM_NAME;
        for (const k of ['NOREPLY', 'HELLO', 'BILLING', 'SUPPORT']) delete process.env[`EMAIL_FROM_${k}`];
    });
    afterAll(() => {
        process.env = OLD_ENV;
    });

    it('maps templates to the right sender, defaulting to noreply', () => {
        expect(senderForTemplate('verify-email')).toBe('noreply');
        expect(senderForTemplate('password.reset')).toBe('noreply');
        expect(senderForTemplate('welcome')).toBe('hello');
        expect(senderForTemplate('membership.invite')).toBe('hello');
        expect(senderForTemplate('settlement.completed')).toBe('billing');
        expect(senderForTemplate('refund')).toBe('billing');
        expect(senderForTemplate('something.unknown')).toBe('noreply');
    });

    it('builds addresses from EMAIL_FROM_DOMAIN', () => {
        process.env.EMAIL_FROM_DOMAIN = 'shop.example';
        expect(resolveSender('hello').email).toBe('hello@shop.example');
        expect(resolveSender('billing').email).toBe('billing@shop.example');
    });

    it('prefers an explicit per-key override', () => {
        process.env.EMAIL_FROM_DOMAIN = 'shop.example';
        process.env.EMAIL_FROM_BILLING = 'payments@pay.shop.example';
        expect(resolveSender('billing').email).toBe('payments@pay.shop.example');
    });

    it('falls back to EMAIL_FROM then a safe default', () => {
        process.env.EMAIL_FROM = 'all@legacy.example';
        expect(resolveSender('hello').email).toBe('all@legacy.example');
        delete process.env.EMAIL_FROM;
        expect(resolveSender('noreply').email).toBe('noreply@invent-io.example');
    });

    it('uses a per-type default name unless EMAIL_FROM_NAME is set', () => {
        expect(resolveSender('billing').name).toBe('Invent-IO Billing');
        process.env.EMAIL_FROM_NAME = 'My Shop';
        expect(resolveSender('billing').name).toBe('My Shop');
    });
});
