export type PaystackSubaccount = {
    subaccount_code: string;
};

export type PaystackCustomer = {
    customer_code: string;
};

export type PaystackDedicatedAccount = {
    account_name: string;
    account_number: string;
    bank: { name: string };
    customer: { customer_code: string };
};

export type CreateSubaccountInput = {
    business_name: string;
    settlement_bank: string;
    account_number: string;
    percentage_charge: number;
    primary_contact_email: string;
    primary_contact_name: string;
    primary_contact_phone?: string;
};

export type CreateCustomerInput = {
    email: string;
    first_name: string;
    last_name: string;
    phone?: string;
};

export type CreateDedicatedAccountInput = {
    customer: string;
    subaccount: string;
    preferred_bank?: string;
};

export class PaystackManagedClient {
    constructor(
        private readonly secretKey: string,
        private readonly request: typeof fetch = fetch,
    ) {
        if (!secretKey.startsWith('sk_test_')) {
            throw new Error('Flow B proof supports Paystack test keys only');
        }
    }

    async createSubaccount(input: CreateSubaccountInput): Promise<PaystackSubaccount> {
        const data = this.asRecord(await this.post('/subaccount', input), '/subaccount');
        return { subaccount_code: this.requiredString(data.subaccount_code, '/subaccount.subaccount_code') };
    }

    async createCustomer(input: CreateCustomerInput): Promise<PaystackCustomer> {
        const data = this.asRecord(await this.post('/customer', input), '/customer');
        return { customer_code: this.requiredString(data.customer_code, '/customer.customer_code') };
    }

    async createDedicatedAccount(input: CreateDedicatedAccountInput): Promise<PaystackDedicatedAccount> {
        const data = this.asRecord(await this.post('/dedicated_account', input), '/dedicated_account');
        const bank = this.asRecord(data.bank, '/dedicated_account.bank');
        const customer = this.asRecord(data.customer, '/dedicated_account.customer');
        return {
            account_name: this.requiredString(data.account_name, '/dedicated_account.account_name'),
            account_number: this.requiredString(data.account_number, '/dedicated_account.account_number'),
            bank: { name: this.requiredString(bank.name, '/dedicated_account.bank.name') },
            customer: {
                customer_code: this.requiredString(
                    customer.customer_code,
                    '/dedicated_account.customer.customer_code',
                ),
            },
        };
    }

    private async post(path: string, body: object): Promise<unknown> {
        const response = await this.request(`https://api.paystack.co${path}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.secretKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        let envelope: unknown;
        try {
            envelope = await response.json();
        } catch {
            throw new Error(`Paystack ${path} returned a non-JSON response (${response.status})`);
        }

        const result = this.asRecord(envelope, `Paystack ${path} response`);
        if (response.ok && result.status === true) {
            return result.data;
        }

        const message = typeof result.message === 'string' ? result.message : 'Invalid provider response';
        throw new Error(`Paystack ${path} failed (${response.status}): ${message}`);
    }

    private asRecord(value: unknown, field: string): Record<string, unknown> {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`Paystack returned an invalid ${field}`);
        }
        return value as Record<string, unknown>;
    }

    private requiredString(value: unknown, field: string): string {
        if (typeof value !== 'string' || value.trim() === '') {
            throw new Error(`Paystack response is missing ${field}`);
        }
        return value;
    }
}
