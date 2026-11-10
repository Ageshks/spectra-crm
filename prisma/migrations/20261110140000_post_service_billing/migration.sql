CREATE TYPE "ServiceInvoiceStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'FINALIZED');
CREATE TYPE "InvoiceItemCategory" AS ENUM ('DELIVERY', 'TRANSPORTATION', 'MATERIAL', 'SPARE_PARTS', 'OTHER_EXPENSE', 'DISCOUNT');
CREATE TYPE "InvoiceAdjustmentType" AS ENUM ('CREDIT_NOTE', 'DEBIT_NOTE');
CREATE TYPE "InvoiceAdjustmentStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'FINALIZED');

ALTER TABLE "Company" ADD COLUMN "gstStateCode" VARCHAR(2);
ALTER TABLE "CustomerAddress" ADD COLUMN "gstStateCode" VARCHAR(2);
ALTER TABLE "Service" ADD COLUMN "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "gstInclusive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Booking" ADD COLUMN "baseServicePrice" DECIMAL(12,2);
UPDATE "Booking" b SET "baseServicePrice" = s."basePrice" FROM "Service" s WHERE s."id" = b."serviceId";
ALTER TABLE "Booking" ALTER COLUMN "baseServicePrice" SET NOT NULL;

CREATE TABLE "ServiceInvoice" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "serviceId" UUID NOT NULL,
  "baseServicePrice" DECIMAL(12,2) NOT NULL,
  "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "taxableAmount" DECIMAL(12,2) NOT NULL,
  "gstRate" DECIMAL(5,2) NOT NULL,
  "gstAmount" DECIMAL(12,2) NOT NULL,
  "cgstAmount" DECIMAL(12,2) NOT NULL,
  "sgstAmount" DECIMAL(12,2) NOT NULL,
  "igstAmount" DECIMAL(12,2) NOT NULL,
  "finalAmount" DECIMAL(12,2) NOT NULL,
  "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
  "status" "ServiceInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "createdById" UUID NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "approvedById" UUID,
  "approvedAt" TIMESTAMP(3),
  "finalizedById" UUID,
  "finalizedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceInvoice_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceInvoice_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceInvoice_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceInvoice_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ServiceInvoice_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ServiceInvoice_bookingId_key" ON "ServiceInvoice"("bookingId");
CREATE UNIQUE INDEX "ServiceInvoice_workOrderId_key" ON "ServiceInvoice"("workOrderId");
CREATE INDEX "ServiceInvoice_companyId_status_createdAt_idx" ON "ServiceInvoice"("companyId", "status", "createdAt");
CREATE INDEX "ServiceInvoice_customerId_status_idx" ON "ServiceInvoice"("customerId", "status");

CREATE TABLE "InvoiceItem" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "category" "InvoiceItemCategory" NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ServiceInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InvoiceItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

CREATE TABLE "InvoiceAttachment" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "invoiceItemId" UUID,
  "fileUrl" TEXT NOT NULL,
  "fileType" VARCHAR(80) NOT NULL,
  "uploadedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceAttachment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ServiceInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InvoiceAttachment_invoiceItemId_fkey" FOREIGN KEY ("invoiceItemId") REFERENCES "InvoiceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InvoiceAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "InvoiceAttachment_invoiceId_idx" ON "InvoiceAttachment"("invoiceId");
CREATE INDEX "InvoiceAttachment_invoiceItemId_idx" ON "InvoiceAttachment"("invoiceItemId");

CREATE TABLE "InvoiceApprovalHistory" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "action" VARCHAR(40) NOT NULL,
  "previousStatus" "ServiceInvoiceStatus",
  "newStatus" "ServiceInvoiceStatus" NOT NULL,
  "remarks" TEXT,
  "performedById" UUID NOT NULL,
  "changes" JSONB,
  "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceApprovalHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceApprovalHistory_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ServiceInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InvoiceApprovalHistory_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "InvoiceApprovalHistory_invoiceId_performedAt_idx" ON "InvoiceApprovalHistory"("invoiceId", "performedAt");

CREATE TABLE "InvoiceAdjustment" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "type" "InvoiceAdjustmentType" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "status" "InvoiceAdjustmentStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "createdById" UUID NOT NULL,
  "approvedById" UUID,
  "approvedAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvoiceAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceAdjustment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ServiceInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InvoiceAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InvoiceAdjustment_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "InvoiceAdjustment_invoiceId_status_createdAt_idx" ON "InvoiceAdjustment"("invoiceId", "status", "createdAt");
