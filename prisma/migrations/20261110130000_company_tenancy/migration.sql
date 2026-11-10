CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Company" ("id", "name", "slug", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000001', 'Default Company', 'default', CURRENT_TIMESTAMP);

CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");
CREATE INDEX "Company_isActive_idx" ON "Company"("isActive");

ALTER TABLE "User" ADD COLUMN "companyId" UUID;
ALTER TABLE "Customer" ADD COLUMN "companyId" UUID;
ALTER TABLE "Employee" ADD COLUMN "companyId" UUID;
ALTER TABLE "Manager" ADD COLUMN "companyId" UUID;
ALTER TABLE "ServiceCategory" ADD COLUMN "companyId" UUID;
ALTER TABLE "Service" ADD COLUMN "companyId" UUID;
ALTER TABLE "Enquiry" ADD COLUMN "companyId" UUID;
ALTER TABLE "Booking" ADD COLUMN "companyId" UUID;
ALTER TABLE "WorkOrder" ADD COLUMN "companyId" UUID;
ALTER TABLE "Setting" ADD COLUMN "companyId" UUID;

UPDATE "User" SET "companyId" = '00000000-0000-4000-8000-000000000001';
UPDATE "Customer" SET "companyId" = COALESCE((SELECT u."companyId" FROM "User" u WHERE u."id" = "Customer"."userId"), '00000000-0000-4000-8000-000000000001');
UPDATE "Employee" SET "companyId" = COALESCE((SELECT u."companyId" FROM "User" u WHERE u."id" = "Employee"."userId"), '00000000-0000-4000-8000-000000000001');
UPDATE "Manager" SET "companyId" = COALESCE((SELECT u."companyId" FROM "User" u WHERE u."id" = "Manager"."userId"), '00000000-0000-4000-8000-000000000001');
UPDATE "ServiceCategory" SET "companyId" = '00000000-0000-4000-8000-000000000001';
UPDATE "Service" SET "companyId" = '00000000-0000-4000-8000-000000000001';
UPDATE "Enquiry" SET "companyId" = '00000000-0000-4000-8000-000000000001';
UPDATE "Booking" SET "companyId" = COALESCE((SELECT c."companyId" FROM "Customer" c WHERE c."id" = "Booking"."customerId"), '00000000-0000-4000-8000-000000000001');
UPDATE "WorkOrder" SET "companyId" = COALESCE((SELECT b."companyId" FROM "Booking" b WHERE b."id" = "WorkOrder"."bookingId"), '00000000-0000-4000-8000-000000000001');
UPDATE "Setting" SET "companyId" = '00000000-0000-4000-8000-000000000001';

ALTER TABLE "Customer" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Employee" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Manager" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "ServiceCategory" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Service" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Enquiry" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Booking" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "WorkOrder" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Setting" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Manager" ADD CONSTRAINT "Manager_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Service" ADD CONSTRAINT "Service_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "User_companyId_role_idx" ON "User"("companyId", "role");
CREATE INDEX "Customer_companyId_idx" ON "Customer"("companyId");
CREATE INDEX "Employee_companyId_idx" ON "Employee"("companyId");
CREATE INDEX "Manager_companyId_idx" ON "Manager"("companyId");
CREATE INDEX "ServiceCategory_companyId_idx" ON "ServiceCategory"("companyId");
CREATE INDEX "Service_companyId_idx" ON "Service"("companyId");
CREATE INDEX "Enquiry_companyId_idx" ON "Enquiry"("companyId");
CREATE INDEX "Booking_companyId_idx" ON "Booking"("companyId");
CREATE INDEX "WorkOrder_companyId_idx" ON "WorkOrder"("companyId");
DROP INDEX "Setting_key_key";
CREATE UNIQUE INDEX "Setting_companyId_key_key" ON "Setting"("companyId", "key");
CREATE INDEX "Setting_companyId_idx" ON "Setting"("companyId");
