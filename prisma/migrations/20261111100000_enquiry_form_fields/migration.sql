ALTER TABLE "Enquiry"
  ADD COLUMN "companyName" VARCHAR(150),
  ADD COLUMN "priority" "WorkOrderPriority" NOT NULL DEFAULT 'NORMAL';
