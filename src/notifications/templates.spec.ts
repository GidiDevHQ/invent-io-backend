import { KNOWN_TEMPLATES, renderTemplate } from './templates';

describe('notification templates', () => {
    it.each(KNOWN_TEMPLATES)('%s renders branded HTML alongside the plain text', (name) => {
        const r = renderTemplate(name, { code: '123456', verifyUrl: 'https://app.example/#/verify-email?token=t' });
        expect(r.body.length).toBeGreaterThan(0);
        expect(r.html).toContain('<title>Invent-IO</title>');
        expect(r.html).toContain('#0b6358'); // brand teal
    });

    it('escapes data placed in the HTML', () => {
        const r = renderTemplate('welcome', { name: '<script>x</script>', businessName: 'A&B' });
        expect(r.html).not.toContain('<script>x</script>');
        expect(r.html).toContain('&lt;script&gt;');
        expect(r.html).toContain('A&amp;B');
    });

    it('puts the verify link on the button', () => {
        const url = 'https://app.example/#/verify-email?token=abc';
        expect(renderTemplate('verify-email', { verifyUrl: url }).html).toContain(`href="${url}"`);
    });

    it('splits a login code into digit boxes', () => {
        const html = renderTemplate('otp', { code: '482913' }).html ?? '';
        for (const d of '482913') expect(html).toContain(`>${d}</td>`);
    });
});
