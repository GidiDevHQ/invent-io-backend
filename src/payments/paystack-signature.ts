import { createHmac, timingSafeEqual } from "crypto";

export function verifyPaystackSignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
    secretKey: string,
): boolean {
    if (!signatureHeader) return false;

    if (!/^[0-9a-f]{128}$/i.test(signatureHeader)) return false;

    const expected = createHmac('sha256', secretKey).update(rawBody).digest();
    const provided =  Buffer.from(signatureHeader, 'hex');

    if (provided.length !== expected.length) return false;
    return timingSafeEqual(expected, provided);
}