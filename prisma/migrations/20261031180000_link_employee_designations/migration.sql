-- Link legacy employee designation text to the designation records used by
-- field-app authorization. Only matching, active designation records qualify.
UPDATE "Employee" e
SET "designationId" = d."id",
    "designation" = d."name",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "Designation" d
WHERE e."designationId" IS NULL
  AND e."designation" IS NOT NULL
  AND lower(trim(e."designation")) = lower(trim(d."name"))
  AND d."isActive" = true;
