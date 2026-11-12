ALTER TABLE "Booking"
  ADD COLUMN "totalAmount" DECIMAL(12,2);

UPDATE "Booking"
SET "totalAmount" = "baseServicePrice";

ALTER TABLE "Booking"
  ALTER COLUMN "totalAmount" SET NOT NULL;

CREATE TABLE "BookingProduct" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "productId" UUID,
    "productName" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookingProduct_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InvoiceItem"
  ADD COLUMN "bookingProductId" UUID;

CREATE INDEX "BookingProduct_bookingId_idx" ON "BookingProduct"("bookingId");
CREATE INDEX "BookingProduct_productId_idx" ON "BookingProduct"("productId");
CREATE UNIQUE INDEX "InvoiceItem_bookingProductId_key" ON "InvoiceItem"("bookingProductId");

ALTER TABLE "BookingProduct"
  ADD CONSTRAINT "BookingProduct_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingProduct"
  ADD CONSTRAINT "BookingProduct_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "InvoiceItem_bookingProductId_fkey"
  FOREIGN KEY ("bookingProductId") REFERENCES "BookingProduct"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
