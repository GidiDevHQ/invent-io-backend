-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "marginReversed" BIGINT NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundItem" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "unitCost" INTEGER NOT NULL,

    CONSTRAINT "RefundItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Refund_organizationId_createdAt_idx" ON "Refund"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Refund_saleId_idx" ON "Refund"("saleId");

-- CreateIndex
CREATE INDEX "RefundItem_refundId_idx" ON "RefundItem"("refundId");

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
