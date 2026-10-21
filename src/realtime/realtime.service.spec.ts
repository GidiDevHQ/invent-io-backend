import { RealtimeService, orgRoom } from './realtime.service';

describe('RealtimeService.identify', () => {
    function make(verify: jest.Mock) {
        return new RealtimeService({ verify } as never);
    }

    it('derives userId and organizationId from a valid token', () => {
        const svc = make(jest.fn().mockReturnValue({ sub: 'u1', org: 'org-1' }));
        expect(svc.identify('good')).toEqual({ userId: 'u1', organizationId: 'org-1' });
    });

    it('allows a token without an org claim', () => {
        const svc = make(jest.fn().mockReturnValue({ sub: 'u1' }));
        expect(svc.identify('t')).toEqual({ userId: 'u1', organizationId: undefined });
    });

    it('throws on a missing token', () => {
        const svc = make(jest.fn());
        expect(() => svc.identify(undefined)).toThrow();
    });

    it('propagates a verify failure', () => {
        const svc = make(jest.fn().mockImplementation(() => { throw new Error('bad'); }));
        expect(() => svc.identify('bad')).toThrow();
    });

    it('builds the org room name', () => {
        expect(orgRoom('abc')).toBe('org:abc');
    });
});
