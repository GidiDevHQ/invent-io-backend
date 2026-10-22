import {
    PaystackManagedClient,
    type CreateDedicatedAccountInput,
    type CreateSubaccountInput,
} from './paystack-managed.client';

describe('PaystackManagedClient', () => {
    const fetchMock = jest.fn<typeof fetch>();
    let client: PaystackManagedClient;

    beforeEach(() => {
        fetchMock.mockReset();
        client = new PaystackManagedClient('sk_test_example', fetchMock);
    });

    it('refuses live credentials before making a request', () => {
        expect(() => new PaystackManagedClient('sk_live_example', fetchMock)).toThrow(
            'Flow B proof supports Paystack test keys only',
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('creates a subaccount with the requested zero platform commission', async () => {
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({
                status: true,
                message: 'Subaccount created',
                data: { subaccount_code: 'ACCT_test' },
            }), { status: 200 }),
        );
        const body: CreateSubaccountInput = {
            business_name: 'Example Org',
            settlement_bank: '058',
            account_number: '0123456789',
            percentage_charge: 0,
            primary_contact_email: 'owner@example.test',
            primary_contact_name: 'Test Owner',
        };

        await expect(client.createSubaccount(body)).resolves.toEqual({ subaccount_code: 'ACCT_test' });
        expect(fetchMock).toHaveBeenCalledWith('https://api.paystack.co/subaccount', expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ Authorization: 'Bearer sk_test_example' }),
            body: JSON.stringify(body),
        }));
    });

    it('creates a customer DVA linked to the returned subaccount code', async () => {
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({
                status: true,
                message: 'Dedicated account created',
                data: {
                    account_name: 'Example Org/Owner',
                    account_number: '0120000000',
                    bank: { name: 'Test Bank' },
                    customer: { customer_code: 'CUS_test' },
                },
            }), { status: 200 }),
        );
        const body: CreateDedicatedAccountInput = {
            customer: 'CUS_test',
            subaccount: 'ACCT_test',
        };

        await expect(client.createDedicatedAccount(body)).resolves.toMatchObject({
            account_number: '0120000000',
            customer: { customer_code: 'CUS_test' },
        });
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.paystack.co/dedicated_account',
            expect.objectContaining({ body: JSON.stringify(body) }),
        );
    });

    it('surfaces provider failures without returning success-shaped data', async () => {
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ status: false, message: 'Invalid bank code', data: null }), {
                status: 400,
            }),
        );

        await expect(client.createSubaccount({
            business_name: 'Example Org',
            settlement_bank: 'bad',
            account_number: '0123456789',
            percentage_charge: 0,
            primary_contact_email: 'owner@example.test',
            primary_contact_name: 'Test Owner',
        })).rejects.toThrow('Paystack /subaccount failed (400): Invalid bank code');
    });

    it('rejects successful responses missing required provider identifiers', async () => {
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ status: true, message: 'Created', data: {} }), { status: 200 }),
        );

        await expect(client.createCustomer({
            email: 'owner@example.test',
            first_name: 'Test',
            last_name: 'Owner',
        })).rejects.toThrow('Paystack response is missing /customer.customer_code');
    });
});
