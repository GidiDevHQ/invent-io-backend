ALTER TABLE "OutboxEvent"
    ADD COLUMN "organizationId" TEXT,
    ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastError" TEXT,
    ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "lockToken" TEXT,
    ADD COLUMN "lockedUntil" TIMESTAMP(3);

CREATE INDEX "OutboxEvent_processedAt_availableAt_lockedUntil_idx"
    ON "OutboxEvent"("processedAt", "availableAt", "lockedUntil");
