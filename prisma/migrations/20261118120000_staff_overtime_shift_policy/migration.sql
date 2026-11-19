ALTER TABLE "Overtime"
  ALTER COLUMN "employeeId" DROP NOT NULL,
  ADD COLUMN "managerId" UUID;

ALTER TABLE "Overtime"
  ADD CONSTRAINT "Overtime_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "Manager"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Overtime_managerId_idx" ON "Overtime"("managerId");

ALTER TABLE "Overtime"
  ADD CONSTRAINT "Overtime_exactly_one_staff_check"
  CHECK (("employeeId" IS NULL) <> ("managerId" IS NULL));
