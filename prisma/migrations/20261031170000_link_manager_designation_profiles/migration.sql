-- Employee records with the Manager designation also need a Manager profile
-- because work orders and manager assignments reference the Manager table.
INSERT INTO "Manager" ("id", "userId", "title", "joinedAt", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  e."userId",
  COALESCE(d."name", e."designation"),
  e."joiningDate",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Employee" e
JOIN "User" u ON u."id" = e."userId"
LEFT JOIN "Designation" d ON d."id" = e."designationId"
WHERE lower(trim(COALESCE(d."name", e."designation", ''))) = 'manager'
  AND NOT EXISTS (
    SELECT 1 FROM "Manager" m WHERE m."userId" = e."userId"
  );

-- Manager-designated employees must receive manager authorization for manager
-- dashboard APIs. Other employee roles are left unchanged.
UPDATE "User" u
SET "role" = 'MANAGER', "updatedAt" = CURRENT_TIMESTAMP
FROM "Employee" e
LEFT JOIN "Designation" d ON d."id" = e."designationId"
WHERE u."id" = e."userId"
  AND lower(trim(COALESCE(d."name", e."designation", ''))) = 'manager'
  AND u."role" = 'EMPLOYEE';
