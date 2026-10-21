export interface RenderedMessage {
    subject?: string;
    body: string;
}

export type TemplateData = Record<string, unknown>;

function money(minor: unknown, currency: unknown): string {
    let n: bigint;
    try {
        n = typeof minor === 'bigint' ? minor : BigInt(String(minor ?? 0));
    } catch {
        n = 0n;
    }
    const neg = n < 0n;
    const abs = neg ? -n : n;
    const whole = abs / 100n;
    const frac = (abs % 100n).toString().padStart(2, '0');
    return `${currency ?? ''} ${neg ? '-' : ''}${whole}.${frac}`.trim();
}

// Named templates only — never ad-hoc strings scattered through the code.
const templates: Record<string, (d: TemplateData) => RenderedMessage> = {
    'payment.received': (d) => ({
        subject: 'Payment received',
        body: `Payment received: ${money(d.amountMinor, d.currency)}. What did you sell? Tap to record it.`,
    }),
    'stock.low': (d) => ({
        subject: 'Low stock alert',
        body: `Low stock: product ${d.productId} is at ${d.qty} (threshold ${d.lowStockThreshold}).`,
    }),
    test: (d) => ({
        subject: 'Invent-IO test',
        body: typeof d.body === 'string' ? d.body : 'This is a test notification from Invent-IO.',
    }),
};

export function renderTemplate(name: string, data: TemplateData = {}): RenderedMessage {
    const t = templates[name];
    if (!t) throw new Error(`Unknown notification template: ${name}`);
    return t(data);
}

export const KNOWN_TEMPLATES = Object.keys(templates);
