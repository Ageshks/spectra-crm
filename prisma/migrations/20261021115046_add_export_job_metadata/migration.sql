-- AlterTable
ALTER TABLE "ExportJob" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "rowCount" INTEGER;

-- CreateIndex
CREATE INDEX "ExportJob_expiresAt_idx" ON "ExportJob"("expiresAt");
