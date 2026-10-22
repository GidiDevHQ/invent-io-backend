-- Cash receipts are confirmed payments without a provider account. Keep
-- provider-backed flows unchanged while allowing this explicit cash method.
ALTER TABLE "Payment"
    DROP CONSTRAINT "Payment_account_flow_check",
    ADD CONSTRAINT "Payment_account_flow_check"
        CHECK (
            ("paymentAccountId" IS NOT NULL
                AND "managedPaymentAccountId" IS NULL
                AND "dedicatedVirtualAccountId" IS NULL)
            OR
            ("paymentAccountId" IS NULL
                AND "managedPaymentAccountId" IS NOT NULL
                AND "dedicatedVirtualAccountId" IS NOT NULL)
            OR
            ("paymentAccountId" IS NULL
                AND "managedPaymentAccountId" IS NULL
                AND "dedicatedVirtualAccountId" IS NULL
                AND "method" = 'cash')
        );

ALTER TABLE "SaleAllocation"
    ADD CONSTRAINT "SaleAllocation_paymentId_fkey"
        FOREIGN KEY ("paymentId")
        REFERENCES "Payment"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Payment_organizationId_branchId_status_occurredAt_idx"
    ON "Payment"("organizationId", "branchId", "status", "occurredAt");
