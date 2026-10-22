-- CreateEnum
CREATE TYPE "ManagedPaymentAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED', 'FAILED');

-- CreateEnum
CREATE TYPE "DedicatedVirtualAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED', 'FAILED');

-- CreateTable
CREATE TABLE "ManagedPaymentAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "ManagedPaymentAccountStatus" NOT NULL DEFAULT 'PENDING',
    "providerSubaccountCode" TEXT,
    "settlementBankCode" TEXT,
    "settlementBankName" TEXT,
    "settlementAccountName" TEXT,
    "settlementAccountLast4" TEXT,
    "percentageCharge" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedPaymentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DedicatedVirtualAccount" (
    "id" TEXT NOT NULL,
    "managedPaymentAccountId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerAccountId" TEXT,
    "providerCustomerCode" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankSlug" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "DedicatedVirtualAccountStatus" NOT NULL DEFAULT 'PENDING',
    "assignedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DedicatedVirtualAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagedPaymentAccount_organizationId_key" ON "ManagedPaymentAccount"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedPaymentAccount_providerSubaccountCode_key" ON "ManagedPaymentAccount"("providerSubaccountCode");

-- CreateIndex
CREATE INDEX "ManagedPaymentAccount_provider_status_idx" ON "ManagedPaymentAccount"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DedicatedVirtualAccount_providerAccountId_key" ON "DedicatedVirtualAccount"("providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "DedicatedVirtualAccount_providerCustomerCode_key" ON "DedicatedVirtualAccount"("providerCustomerCode");

-- CreateIndex
CREATE UNIQUE INDEX "DedicatedVirtualAccount_accountNumber_key" ON "DedicatedVirtualAccount"("accountNumber");

-- CreateIndex
CREATE INDEX "DedicatedVirtualAccount_managedPaymentAccountId_status_idx" ON "DedicatedVirtualAccount"("managedPaymentAccountId", "status");

-- AddForeignKey
ALTER TABLE "ManagedPaymentAccount" ADD CONSTRAINT "ManagedPaymentAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DedicatedVirtualAccount" ADD CONSTRAINT "DedicatedVirtualAccount_managedPaymentAccountId_fkey" FOREIGN KEY ("managedPaymentAccountId") REFERENCES "ManagedPaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
