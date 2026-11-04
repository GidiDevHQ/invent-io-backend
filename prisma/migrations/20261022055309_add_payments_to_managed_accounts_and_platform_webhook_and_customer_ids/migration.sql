-- NOTE: This migration was originally generated to drop and re-add the three
-- Payment foreign keys, but it is sequenced BEFORE the migrations that create
-- the ManagedPaymentAccount / DedicatedVirtualAccount tables and the Payment
-- columns those keys reference (20261022055500, 20261022062000). On a clean
-- `prisma migrate deploy` replay it therefore aborted:
--   * DROP of a constraint that does not exist yet  -> 42704
--   * ADD referencing "ManagedPaymentAccount"       -> 42P01
-- which is why cloud deploys to a fresh database failed and every query 500'd.
--
-- The payment foreign keys are correctly created by 20261022062000 and given
-- their final ON DELETE SET NULL behaviour by 20261022140000, so this migration
-- has nothing left to do. It is reduced to idempotent, replay-safe drops: a
-- no-op on a fresh database, and harmless on any older database.
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_dedicatedVirtualAccountId_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_managedPaymentAccountId_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_paymentAccountId_fkey";
