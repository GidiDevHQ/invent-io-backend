-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_dedicatedVirtualAccountId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_managedPaymentAccountId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_paymentAccountId_fkey";

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_managedPaymentAccountId_fkey" FOREIGN KEY ("managedPaymentAccountId") REFERENCES "ManagedPaymentAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_dedicatedVirtualAccountId_fkey" FOREIGN KEY ("dedicatedVirtualAccountId") REFERENCES "DedicatedVirtualAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
