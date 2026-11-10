CREATE TABLE "ServiceReportLocation" (
    "id" UUID NOT NULL,
    "serviceReportId" UUID NOT NULL,
    "submittedById" UUID,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "capturedAt" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceReportLocation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Leave" ADD COLUMN "reviewNote" VARCHAR(1000);

CREATE INDEX "ServiceReportLocation_serviceReportId_recordedAt_idx"
ON "ServiceReportLocation"("serviceReportId", "recordedAt");

CREATE INDEX "ServiceReportLocation_submittedById_idx"
ON "ServiceReportLocation"("submittedById");

ALTER TABLE "ServiceReportLocation"
ADD CONSTRAINT "ServiceReportLocation_serviceReportId_fkey"
FOREIGN KEY ("serviceReportId") REFERENCES "ServiceReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceReportLocation"
ADD CONSTRAINT "ServiceReportLocation_submittedById_fkey"
FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
