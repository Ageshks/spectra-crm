INSERT INTO "Designation" ("id", "name", "isActive", "updatedAt")
SELECT gen_random_uuid(), defaults."name", true, CURRENT_TIMESTAMP
FROM (VALUES
    ('Field Worker'),
    ('Temp Staff'),
    ('Office Staff'),
    ('Supervisor'),
    ('Manager'),
    ('Admin')
) AS defaults("name")
WHERE NOT EXISTS (
    SELECT 1
    FROM "Designation" AS existing
    WHERE lower(existing."name") = lower(defaults."name")
);
