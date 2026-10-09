/**
 * Money is always integer minor units (e.g. kobo, cents) plus an ISO 4217
 * currency code. Never a float. All money arithmetic goes through these helpers
 * so the "no floating-point money" invariant holds in one place.
 */
export interface Money {
    /** Integer minor units. Must be a safe integer. */
    amount: number;
    /** ISO 4217 currency code, e.g. "NGN". */
    currency: string;
}

function assertInteger(amount: number): void {
    if (!Number.isInteger(amount)) {
        throw new Error(`Money amount must be an integer in minor units, got: ${amount}`);
    }
}

export function money(amount: number, currency: string): Money {
    assertInteger(amount);
    if (!currency || currency.length !== 3) {
        throw new Error(`Invalid currency code: ${currency}`);
    }
    return { amount, currency: currency.toUpperCase() };
}

export function zero(currency: string): Money {
    return money(0, currency);
}

function assertSameCurrency(a: Money, b: Money): void {
    if (a.currency !== b.currency) {
        throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
    }
}

export function add(a: Money, b: Money): Money {
    assertSameCurrency(a, b);
    return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
    assertSameCurrency(a, b);
    return money(a.amount - b.amount, a.currency);
}

/** Multiply money by an integer quantity (e.g. unit price * qty). */
export function multiply(m: Money, factor: number): Money {
    assertInteger(factor);
    return money(m.amount * factor, m.currency);
}

export function isNegative(m: Money): boolean {
    return m.amount < 0;
}

export function isZero(m: Money): boolean {
    return m.amount === 0;
}
