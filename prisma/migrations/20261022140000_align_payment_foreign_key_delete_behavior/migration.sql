-- The final Prisma model makes all three payment-account relations optional.
-- Keep their database referential actions aligned with that model in both
-- existing local databases and clean shadow-database replays.
ALTER TABLE "Payment"
    DROP CONSTRAINT IF EXISTS "Payment_paymentAccountId_fkey",
    DROP CONSTRAINT IF EXISTS "Payment_managedPaymentAccountId_fkey",
    DROP CONSTRAINT IF EXISTS "Payment_dedicatedVirtualAccountId_fkey";

ALTER TABLE "Payment"
    ADD CONSTRAINT "Payment_paymentAccountId_fkey"
        FOREIGN KEY ("paymentAccountId")
        REFERENCES "PaymentAccount"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "Payment_managedPaymentAccountId_fkey"
        FOREIGN KEY ("managedPaymentAccountId")
        REFERENCES "ManagedPaymentAccount"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "Payment_dedicatedVirtualAccountId_fkey"
        FOREIGN KEY ("dedicatedVirtualAccountId")
        REFERENCES "DedicatedVirtualAccount"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
