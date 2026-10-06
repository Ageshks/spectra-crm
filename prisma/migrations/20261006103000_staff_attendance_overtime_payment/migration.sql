CREATE TYPE "OvertimePaymentStatus" AS ENUM ('UNPAID', 'PAID');

ALTER TABLE "Attendance"
  ALTER COLUMN "employeeId" DROP NOT NULL,
  ADD COLUMN "managerId" UUID;

CREATE UNIQUE INDEX "Attendance_managerId_date_key"
  ON "Attendance"("managerId", "date");

ALTER TABLE "Attendance"
  ADD CONSTRAINT "Attendance_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "Manager"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Overtime"
  ADD COLUMN "paymentAmount" DECIMAL(10,2),
  ADD COLUMN "paymentStatus" "OvertimePaymentStatus" NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "paymentReference" VARCHAR(120);
