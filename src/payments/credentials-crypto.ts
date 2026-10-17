import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function loadKey(): Buffer {
    const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
    if (!raw) throw new Error('CREDENTIALS_ENCRYPTION_KEY is not set');
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
        throw new Error('CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes');
    }
    return key
}

export function encryptSecret(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', loadKey(), iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return[iv, tag, ct].map((b) => b.toString('base64')).join(':');
}

export function decryptSecret(stored: string): string {
    const parts = stored.split(':');
    if (parts.length !== 3) throw new Error('Malformed secretCiphertext');
    const [iv, tag, ct] = parts.map((p) => Buffer.from(p, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', loadKey(), iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8')
}