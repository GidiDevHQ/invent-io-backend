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
    // 1. Core loop
    'payment.received': (d) => ({
        subject: 'Payment received',
        body: `Payment received: ${money(d.amountMinor ?? d.amount, d.currency)}. What did you sell? Tap to record it.`,
    }),
    'stock.low': (d) => ({
        subject: 'Low stock alert',
        body: `Low stock: product ${d.productId} is at ${d.qty} (threshold ${d.lowStockThreshold}).`,
    }),
    // 2. Scheduled
    'weekly.summary': (d) => ({
        subject: 'Your weekly summary',
        body:
            `This week: revenue ${money(d.revenue, d.currency)}, margin ${money(d.margin, d.currency)}.\n` +
            `Top sellers: ${Array.isArray(d.topSellers) ? d.topSellers.join(', ') : '—'}.\n` +
            `Low/out of stock: ${Array.isArray(d.lowStock) ? d.lowStock.join(', ') : 'none'}.`,
    }),
    // 3. Account & auth
    'membership.invite': (d) => ({
        subject: `You've been invited to ${d.orgName ?? 'a team'}`,
        body: `You've been invited to ${d.orgName ?? 'a team'} as ${d.role ?? 'a member'}. Accept: ${d.inviteUrl ?? ''}`.trim(),
    }),
    otp: (d) => ({
        subject: 'Your login code',
        body: `Your Invent-IO login code is ${d.code}. It expires in 5 minutes.`,
    }),
    // 4. Transactional confirmations
    'sale.variance': (d) => ({
        subject: 'Sale recorded with a discrepancy',
        body: `A sale was recorded with a variance of ${money(d.variance, d.currency)} against the payment. Please review.`,
    }),
    refund: (d) => ({
        subject: 'Refund processed',
        body: `A refund of ${money(d.amountMinor ?? d.amount, d.currency)} has been processed.`,
    }),
    // 5. Managed/escrow (simulated)
    'settlement.completed': (d) => ({
        subject: 'Payout completed',
        body: `${money(d.amountMinor ?? d.amount, d.currency)} has been paid out to your bank account.`,
    }),
    // misc
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
