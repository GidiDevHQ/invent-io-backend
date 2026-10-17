import { createHmac } from "node:crypto";
import { verifyPaystackSignature } from "./paystack-signature";

const secret = 'sk_test_dummy'
const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'r1' } }));
const sign = (b: Buffer, s = secret) => createHmac('sha256', s).update(b).digest('hex');

describe('verifyPaystackSignature', () => {
    it('accepts a valid signature', () => {
        const signature = sign(body);
        expect(verifyPaystackSignature(body, signature, secret)).toBe(true);
    });

    it('rejects a signature with a different secret', () => {
        const signature = sign(body, 'sk_test_other');
        expect(verifyPaystackSignature(body, signature, secret)).toBe(false);
    });

    it('rejects a tampered body', () => {
        const signature = sign(body);
        const tamperedBody = Buffer.from(body.toString('utf8').replace('r1', 'r2'));
        expect(verifyPaystackSignature(tamperedBody, signature, secret)).toBe(false);
    });

    it('rejects a missing header', () => {
        expect(verifyPaystackSignature(body, undefined, secret)).toBe(false);
    });

    it('rejects wrong-length and non-hex input without throwing', () => {
        expect(verifyPaystackSignature(body, 'abc123', secret)).toBe(false);
        expect(verifyPaystackSignature(body, 'z'.repeat(128), secret)).toBe(false);
        const signature = sign(body);
        expect(verifyPaystackSignature(body, signature + 'aa', secret)).toBe(false);
    });
});