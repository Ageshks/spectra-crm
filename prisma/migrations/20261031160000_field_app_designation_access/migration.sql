ALTER TABLE "Designation"
ADD COLUMN "canUseFieldApp" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "Designation" ("id", "name", "isActive", "updatedAt")
SELECT gen_random_uuid(), 'Field Technician', true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1
    FROM "Designation"
    WHERE lower("name") = lower('Field Technician')
);

UPDATE "Designation"
SET "canUseFieldApp" = lower("name") IN (lower('Temp Staff'), lower('Field Technician'));
