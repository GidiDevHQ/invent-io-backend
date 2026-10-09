import { add, isNegative, isZero, money, multiply, subtract, zero } from './money';

describe('money', () => {
    it('constructs from integer minor units', () => {
        expect(money(1500, 'ngn')).toEqual({ amount: 1500, currency: 'NGN' });
    });

    it('rejects floating-point amounts', () => {
        expect(() => money(10.5, 'NGN')).toThrow();
    });

    it('rejects invalid currency codes', () => {
        expect(() => money(100, 'NG')).toThrow();
    });

    it('adds and subtracts same-currency money', () => {
        expect(add(money(100, 'NGN'), money(250, 'NGN'))).toEqual(money(350, 'NGN'));
        expect(subtract(money(250, 'NGN'), money(100, 'NGN'))).toEqual(money(150, 'NGN'));
    });

    it('refuses to mix currencies', () => {
        expect(() => add(money(100, 'NGN'), money(100, 'USD'))).toThrow();
    });

    it('multiplies only by integer factors', () => {
        expect(multiply(money(150, 'NGN'), 3)).toEqual(money(450, 'NGN'));
        expect(() => multiply(money(150, 'NGN'), 2.5)).toThrow();
    });

    it('reports sign and zero', () => {
        expect(isNegative(money(-1, 'NGN'))).toBe(true);
        expect(isZero(zero('NGN'))).toBe(true);
    });
});
