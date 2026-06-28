-- AlterTable
ALTER TABLE "profile_education" ADD COLUMN     "college_master_id" INTEGER,
ADD COLUMN     "school_master_id" INTEGER;

-- CreateTable
CREATE TABLE "school_master" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "school_master_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "college_master" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "college_master_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "profile_education" ADD CONSTRAINT "profile_education_school_master_id_fkey" FOREIGN KEY ("school_master_id") REFERENCES "school_master"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_education" ADD CONSTRAINT "profile_education_college_master_id_fkey" FOREIGN KEY ("college_master_id") REFERENCES "college_master"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the school/college catalogs from existing profile entries (as approved), so they're
-- reusable, then link each profile row to its catalog entry.
INSERT INTO "school_master" ("name", "is_active")
SELECT DISTINCT TRIM("school_name"), true
FROM "profile_education"
WHERE "school_name" IS NOT NULL AND TRIM("school_name") <> '';

INSERT INTO "college_master" ("name", "is_active")
SELECT DISTINCT TRIM("college_name"), true
FROM "profile_education"
WHERE "college_name" IS NOT NULL AND TRIM("college_name") <> '';

UPDATE "profile_education" pe
SET "school_master_id" = sm."id"
FROM "school_master" sm
WHERE pe."school_name" IS NOT NULL AND TRIM(pe."school_name") = sm."name";

UPDATE "profile_education" pe
SET "college_master_id" = cm."id"
FROM "college_master" cm
WHERE pe."college_name" IS NOT NULL AND TRIM(pe."college_name") = cm."name";
