import { createHmac, timingSafeEqual } from 'crypto';

export function verifyPaystackSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secretKey: string,
): boolean {
  if (!signatureHeader) return false;

  // SHA-512 is 64 bytes, represented as 128 hexadecimal characters.
  if (!/^[0-9a-f]{128}$/i.test(signatureHeader)) return false;

  // Verify the exact bytes received; parsing and re-serializing JSON changes the HMAC.
  const expected = createHmac('sha512', secretKey).update(rawBody).digest();
  const provided = Buffer.from(signatureHeader, 'hex');

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(expected, provided);
}
