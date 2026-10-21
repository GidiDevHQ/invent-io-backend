-- AlterTable
ALTER TABLE "NotificationLog" ADD COLUMN "eventId" TEXT;

-- CreateIndex
CREATE INDEX "NotificationLog_eventId_idx" ON "NotificationLog"("eventId");
