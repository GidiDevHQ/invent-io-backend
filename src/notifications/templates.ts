import {
    amount,
    appUrl,
    badge,
    btn,
    codeDigits,
    divider,
    esc,
    fallbackLink,
    greeting,
    h1,
    infoTable,
    label,
    list,
    notice,
    p,
    pSmall,
    row,
    shell,
} from './email-layout';

export interface RenderedMessage {
    subject?: string;
    /** Plain text: WhatsApp, Web Push, and the email's text part. */
    body: string;
    /** Branded HTML for email. Without it the email channel wraps `body`. */
    html?: string;
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

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);

// Named templates only â€” never ad-hoc strings scattered through the code.
const templates: Record<string, (d: TemplateData) => RenderedMessage> = {
    // 1. Core loop
    'payment.received': (d) => {
        const amt = money(d.amountMinor ?? d.amount, d.currency);
        return {
            subject: 'Payment received',
            body: `Payment received: ${amt}. What did you sell? Tap to record it.`,
            html: shell(
                label('Payment') +
                    h1('Payment received') +
                    infoTable([row('Amount', amount(esc(amt)), true)]) +
                    p('Record what was sold so your stock and margins stay accurate.') +
                    btn('Record the sale', appUrl('sales')),
            ),
        };
    },
    'stock.low': (d) => ({
        subject: 'Low stock alert',
        body: `Low stock: product ${d.productId} is at ${d.qty} (threshold ${d.lowStockThreshold}).`,
        html: shell(
            label('Inventory') +
                h1('Stock is running low') +
                infoTable([
                    row('Product', esc(d.productName ?? d.productId)),
                    row('In stock', amount(esc(d.qty), 'error')),
                    row('Alert level', esc(d.lowStockThreshold), true),
                ]) +
                notice('Restock soon so you do not miss sales.', 'warning') +
                btn('View inventory', appUrl('products')),
        ),
    }),
    // 2. Scheduled
    'weekly.summary': (d) => {
        const top = strings(d.topSellers);
        const low = strings(d.lowStock);
        return {
            subject: 'Your weekly summary',
            body:
                `This week: revenue ${money(d.revenue, d.currency)}, margin ${money(d.margin, d.currency)}.\n` +
                `Top sellers: ${top.length ? top.join(', ') : 'â€”'}.\n` +
                `Low/out of stock: ${low.length ? low.join(', ') : 'none'}.`,
            html: shell(
                label('Weekly summary') +
                    h1('Your week at a glance') +
                    infoTable([
                        row('Revenue', amount(esc(money(d.revenue, d.currency)))),
                        row('Margin', amount(esc(money(d.margin, d.currency))), true),
                    ]) +
                    `<p style="margin:0 0 8px;font-size:13px;font-weight:700;">Top sellers</p>` +
                    (top.length ? list(top.map(esc)) : p('No sales recorded this week.')) +
                    `<p style="margin:0 0 8px;font-size:13px;font-weight:700;">Low or out of stock</p>` +
                    (low.length ? list(low.map(esc)) : p('Nothing is running low.')) +
                    btn('Open reports', appUrl('home')),
            ),
        };
    },
    // 3. Account & auth
    welcome: (d) => ({
        subject: `Welcome to Invent-IO${d.businessName ? ', ' + d.businessName : ''}`,
        body:
            `Hi ${d.name ?? 'there'}, your Invent-IO account is ready. ` +
            `Connect a payment account and add your products, and every payment that ` +
            `lands turns into a confirmed sale in seconds. We're glad you're here.`,
        html: shell(
            greeting(d.name) +
                label('Welcome') +
                h1(`Your account is ready${d.businessName ? `, ${esc(d.businessName)}` : ''}`) +
                p('Every payment that lands turns into a confirmed sale in seconds. Two steps to get there:') +
                list([
                    '<strong>Connect a payment account</strong> so payments reach Invent-IO.',
                    '<strong>Add your products</strong> one by one, or import a CSV.',
                ]) +
                btn('Get started', appUrl('onboarding')) +
                divider() +
                pSmall('Questions? Reply to this email and we will help.'),
        ),
    }),
    'verify-email': (d) => {
        const url = String(d.verifyUrl ?? '');
        return {
            subject: 'Confirm your email',
            body:
                `Welcome to Invent-IO${d.name ? ', ' + d.name : ''}! ` +
                `Confirm your email address to secure your account: ${url}\n` +
                `This link expires in 24 hours.`,
            html: shell(
                greeting(d.name) +
                    label('Verification') +
                    h1('Confirm your email') +
                    p('Confirm this address to secure your Invent-IO account. The link expires in <strong>24 hours</strong>.') +
                    btn('Confirm email', url) +
                    divider() +
                    fallbackLink(url),
            ),
        };
    },
    'password.reset': (d) => {
        const url = String(d.resetUrl ?? '');
        return {
            subject: 'Reset your password',
            body:
                `We received a request to reset your Invent-IO password. ` +
                `Set a new one here: ${url}\n` +
                `This link expires in 1 hour. If you didn't ask for this, you can ignore this email.`,
            html: shell(
                label('Password reset') +
                    h1('Reset your password') +
                    p('We received a request to reset your Invent-IO password. The link expires in <strong>1 hour</strong> and works once.') +
                    btn('Reset password', url) +
                    divider() +
                    p('If you did not ask for this, ignore this email. Your password will not change.') +
                    fallbackLink(url),
            ),
        };
    },
    'membership.invite': (d) => {
        const url = String(d.inviteUrl ?? '');
        const org = esc(d.orgName ?? 'a team');
        return {
            subject: `You've been invited to ${d.orgName ?? 'a team'}`,
            body: `You've been invited to ${d.orgName ?? 'a team'} as ${d.role ?? 'a member'}. Accept: ${url}`.trim(),
            html: shell(
                label('Invitation') +
                    h1(`Join ${org} on Invent-IO`) +
                    infoTable([
                        row('Team', `<strong>${org}</strong>`),
                        row('Role', badge(esc(d.role ?? 'member'), 'success'), true),
                    ]) +
                    btn('Accept invitation', url) +
                    divider() +
                    fallbackLink(url),
            ),
        };
    },
    otp: (d) => ({
        subject: 'Your login code',
        body: `Your Invent-IO login code is ${d.code}. It expires in 5 minutes.`,
        html: shell(
            label('Verification') +
                h1('Your sign-in code') +
                p('Enter this code to sign in. It expires in <strong>5 minutes</strong> and works once.') +
                codeDigits(String(d.code ?? '')) +
                notice('Never share this code. Invent-IO will never ask for it.', 'info') +
                pSmall('If you did not request this code, ignore this email. Your account is safe.'),
        ),
    }),
    // 4. Transactional confirmations
    'sale.variance': (d) => ({
        subject: 'Sale recorded with a discrepancy',
        body: `A sale was recorded with a variance of ${money(d.variance, d.currency)} against the payment. Please review.`,
        html: shell(
            label('Needs review') +
                h1('Sale recorded with a discrepancy') +
                infoTable([row('Variance', amount(esc(money(d.variance, d.currency)), 'error'), true)]) +
                notice('The recorded items do not match the payment amount. Check the sale and correct it if needed.', 'warning') +
                btn('Review the sale', appUrl('sales')),
        ),
    }),
    refund: (d) => {
        const amt = money(d.amountMinor ?? d.amount, d.currency);
        return {
            subject: 'Refund processed',
            body: `A refund of ${amt} has been processed.`,
            html: shell(
                label('Billing') +
                    h1('Refund processed') +
                    infoTable([
                        row('Amount', amount(esc(amt))),
                        row('Status', badge('Completed', 'success'), true),
                    ]) +
                    p('Returned items have been added back to stock.') +
                    btn('View sales', appUrl('sales')),
            ),
        };
    },
    // 5. Managed/escrow (simulated)
    'settlement.completed': (d) => {
        const amt = money(d.amountMinor ?? d.amount, d.currency);
        return {
            subject: 'Payout completed',
            body: `${amt} has been paid out to your bank account.`,
            html: shell(
                label('Payout') +
                    h1('Your payout is on its way') +
                    infoTable([
                        row('Amount', amount(esc(amt))),
                        row('Status', badge('Paid out', 'success'), true),
                    ]) +
                    pSmall('Banks can take up to one business day to show the money in your account.'),
            ),
        };
    },
    // misc
    test: (d) => {
        const body = typeof d.body === 'string' ? d.body : 'This is a test notification from Invent-IO.';
        return {
            subject: 'Invent-IO test',
            body,
            html: shell(label('Test') + h1('Test notification') + p(esc(body))),
        };
    },
};

export function renderTemplate(name: string, data: TemplateData = {}): RenderedMessage {
    const t = templates[name];
    if (!t) throw new Error(`Unknown notification template: ${name}`);
    return t(data);
}

export const KNOWN_TEMPLATES = Object.keys(templates);
