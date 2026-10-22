import { PaystackManagedClient } from './paystack-managed.client';

export const PAYSTACK_MANAGED_CLIENT_FACTORY = Symbol('PAYSTACK_MANAGED_CLIENT_FACTORY');

export type PaystackManagedClientFactory = () => PaystackManagedClient;

export function createPaystackManagedClient(): PaystackManagedClient {
    const secretKey = process.env.PAYSTACK_TEST_SECRET_KEY;
    if (!secretKey) throw new Error('PAYSTACK_TEST_SECRET_KEY is not configured');
    return new PaystackManagedClient(secretKey);
}
