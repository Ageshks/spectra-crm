CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductPhoto" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "publicId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Product_companyId_idx" ON "Product"("companyId");
CREATE INDEX "Product_isActive_idx" ON "Product"("isActive");
CREATE INDEX "Product_name_idx" ON "Product"("name");
CREATE INDEX "ProductPhoto_productId_position_idx" ON "ProductPhoto"("productId", "position");

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductPhoto"
  ADD CONSTRAINT "ProductPhoto_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
