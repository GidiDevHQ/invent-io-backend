-- Allow Flow B payments to be associated with the managed Paystack account and
-- the exact DVA that received the payment instead of a DIRECT PaymentAccount.
ALTER TABLE "Payment"
    ALTER COLUMN "paymentAccountId" DROP NOT NULL,
    ADD COLUMN "managedPaymentAccountId" TEXT,
    ADD COLUMN "dedicatedVirtualAccountId" TEXT;

CREATE UNIQUE INDEX "Payment_managedPaymentAccountId_providerReference_key"
    ON "Payment"("managedPaymentAccountId", "providerReference");

CREATE INDEX "Payment_dedicatedVirtualAccountId_occurredAt_idx"
    ON "Payment"("dedicatedVirtualAccountId", "occurredAt");

ALTER TABLE "Payment"
    ADD CONSTRAINT "Payment_managedPaymentAccountId_fkey"
        FOREIGN KEY ("managedPaymentAccountId")
        REFERENCES "ManagedPaymentAccount"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Payment_dedicatedVirtualAccountId_fkey"
        FOREIGN KEY ("dedicatedVirtualAccountId")
        REFERENCES "DedicatedVirtualAccount"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Payment_account_flow_check"
        CHECK (
            ("paymentAccountId" IS NOT NULL
                AND "managedPaymentAccountId" IS NULL
                AND "dedicatedVirtualAccountId" IS NULL)
            OR
            ("paymentAccountId" IS NULL
                AND "managedPaymentAccountId" IS NOT NULL
                AND "dedicatedVirtualAccountId" IS NOT NULL)
        );
