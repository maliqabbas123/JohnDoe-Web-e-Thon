-- Keep evidence immutable after exam names, grades or public URLs change.
ALTER TABLE "Report" ADD COLUMN "examTitle" TEXT,
ADD COLUMN "pdfBytes" BYTEA,
ADD COLUMN "verificationUrl" TEXT;
