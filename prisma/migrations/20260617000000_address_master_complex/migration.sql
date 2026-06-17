-- AlterTable: add the curated building/complex name used for search autofill.
ALTER TABLE "address_master" ADD COLUMN "complex" TEXT;
