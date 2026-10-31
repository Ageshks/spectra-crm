CREATE TABLE "Designation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Designation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Designation_name_key" ON "Designation"("name");
CREATE INDEX "Designation_isActive_idx" ON "Designation"("isActive");

ALTER TABLE "Employee" ADD COLUMN "designationId" UUID;

-- Preserve existing free-text designations as reusable options and link current employees.
INSERT INTO "Designation" ("id", "name", "updatedAt")
SELECT gen_random_uuid(), "designation", CURRENT_TIMESTAMP
FROM "Employee"
WHERE "designation" IS NOT NULL AND btrim("designation") <> ''
GROUP BY "designation"
ON CONFLICT ("name") DO NOTHING;

UPDATE "Employee" AS employee
SET "designationId" = designation."id"
FROM "Designation" AS designation
WHERE employee."designation" = designation."name";

CREATE INDEX "Employee_designationId_idx" ON "Employee"("designationId");

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_designationId_fkey"
    FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
