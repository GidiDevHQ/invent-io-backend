ALTER TABLE "ManagedPaymentAccount"
    ADD COLUMN "providerCustomerCode" TEXT;

CREATE UNIQUE INDEX "ManagedPaymentAccount_providerCustomerCode_key"
    ON "ManagedPaymentAccount"("providerCustomerCode");

ALTER TABLE "WebhookEvent"
    ADD COLUMN "platformDedupeKey" TEXT;

CREATE UNIQUE INDEX "WebhookEvent_platformDedupeKey_key"
    ON "WebhookEvent"("platformDedupeKey");

ALTER TABLE "ManagedPaymentAccount"
    ADD COLUMN "settlementAccountCiphertext" TEXT;
