CREATE TABLE "WorkPhotoContent" (
    "workPhotoId" UUID NOT NULL,
    "imageData" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkPhotoContent_pkey" PRIMARY KEY ("workPhotoId"),
    CONSTRAINT "WorkPhotoContent_workPhotoId_fkey"
      FOREIGN KEY ("workPhotoId") REFERENCES "WorkPhoto"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);
