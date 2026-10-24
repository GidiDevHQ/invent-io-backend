/**
 * Which "from" address an email goes out as, chosen by the kind of email it is.
 * A security email (verification, reset) should come from noreply@, a friendly
 * onboarding note from hello@, money matters from billing@, and so on — so the
 * sender is attached to the email *type*, not set by each caller.
 */
export type SenderKey = 'noreply' | 'hello' | 'billing' | 'support';

export interface SenderIdentity {
    email: string;
    name: string;
}

const DEFAULT_NAMES: Record<SenderKey, string> = {
    noreply: 'Invent-IO',
    hello: 'The Invent-IO Team',
    billing: 'Invent-IO Billing',
    support: 'Invent-IO Support',
};

// Explicit per-key address overrides, if an operator wants to set them directly.
const ENV_KEYS: Record<SenderKey, string> = {
    noreply: 'EMAIL_FROM_NOREPLY',
    hello: 'EMAIL_FROM_HELLO',
    billing: 'EMAIL_FROM_BILLING',
    support: 'EMAIL_FROM_SUPPORT',
};

// Named email templates → the sender they go out as. Anything unmapped is noreply.
const TEMPLATE_SENDERS: Record<string, SenderKey> = {
    // Account & security
    'verify-email': 'noreply',
    'password.reset': 'noreply',
    otp: 'noreply',
    // Onboarding & people
    welcome: 'hello',
    'membership.invite': 'hello',
    'weekly.summary': 'hello',
    // Money
    'payment.received': 'billing',
    'settlement.completed': 'billing',
    refund: 'billing',
    // Operational alerts
    'stock.low': 'noreply',
    'sale.variance': 'noreply',
};

/** Resolve a sender key to a concrete {email, name}, from env with safe defaults. */
export function resolveSender(key: SenderKey): SenderIdentity {
    const explicit = process.env[ENV_KEYS[key]];
    const domain = process.env.EMAIL_FROM_DOMAIN;
    const email =
        (explicit && explicit.trim()) ||
        (domain ? `${key}@${domain.trim()}` : undefined) ||
        process.env.EMAIL_FROM ||
        `${key}@invent-io.example`;
    const name = process.env.EMAIL_FROM_NAME || DEFAULT_NAMES[key];
    return { email, name };
}

/** Which sender a given template goes out as (defaults to noreply). */
export function senderForTemplate(template: string): SenderKey {
    return TEMPLATE_SENDERS[template] ?? 'noreply';
}
