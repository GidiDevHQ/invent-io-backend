import 'dotenv/config';
import { PaystackManagedClient } from '../src/payments/paystack-managed.client';

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Set ${name} in your local .env`);
    return value;
}

async function main() {
    const secretKey = required('PAYSTACK_TEST_SECRET_KEY');
    const businessName = required('FLOW_B_BUSINESS_NAME');
    const settlementBank = required('FLOW_B_SETTLEMENT_BANK');
    const settlementAccountNumber = required('FLOW_B_SETTLEMENT_ACCOUNT_NUMBER');
    const ownerEmail = required('FLOW_B_OWNER_EMAIL');
    const ownerName = required('FLOW_B_OWNER_NAME');
    const customerFirstName = required('FLOW_B_CUSTOMER_FIRST_NAME');
    const customerLastName = required('FLOW_B_CUSTOMER_LAST_NAME');
    const ownerPhone = process.env.FLOW_B_OWNER_PHONE?.trim();
    const client = new PaystackManagedClient(secretKey);
    const preferredBank = process.env.FLOW_B_PREFERRED_BANK?.trim();

    const subaccount = await client.createSubaccount({
        business_name: businessName,
        settlement_bank: settlementBank,
        account_number: settlementAccountNumber,
        percentage_charge: 0,
        primary_contact_email: ownerEmail,
        primary_contact_name: ownerName,
        ...(ownerPhone ? { primary_contact_phone: ownerPhone } : {}),
    });
    console.log(`Created sandbox subaccount: ${subaccount.subaccount_code}`);

    const customer = await client.createCustomer({
        email: ownerEmail,
        first_name: customerFirstName,
        last_name: customerLastName,
        ...(ownerPhone ? { phone: ownerPhone } : {}),
    });
    console.log(`Created sandbox customer: ${customer.customer_code}`);

    const dedicatedAccount = await client.createDedicatedAccount({
        customer: customer.customer_code,
        subaccount: subaccount.subaccount_code,
        ...(preferredBank ? { preferred_bank: preferredBank } : {}),
    });

    console.log('Flow B sandbox provisioning succeeded.');
    console.log(`DVA bank: ${dedicatedAccount.bank.name}`);
    console.log(`DVA account name: ${dedicatedAccount.account_name}`);
    console.log(`DVA account number: ${dedicatedAccount.account_number}`);
    console.log('Next: make a sandbox transfer and verify its transaction, webhook, and settlement destination in Paystack.');
}

main().catch((error: unknown) => {
    console.error('Flow B sandbox provisioning failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
