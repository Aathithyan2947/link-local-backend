-- AlterTable
ALTER TABLE "education_master" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "profession_master" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "profile_education" ADD COLUMN     "college_city" TEXT,
ADD COLUMN     "college_name" TEXT,
ADD COLUMN     "degree" TEXT,
ADD COLUMN     "post_grad_city" TEXT,
ADD COLUMN     "post_grad_college" TEXT,
ADD COLUMN     "school_city" TEXT,
ADD COLUMN     "school_name" TEXT,
ADD COLUMN     "university" TEXT;

-- Backfill: move each member's education details from the (previously per-user) education_master
-- onto their profile_education row, so EducationMaster can serve purely as the degree catalog.
UPDATE "profile_education" pe
SET "degree"            = em."degree",
    "school_name"       = em."school_name",
    "school_city"       = em."school_city",
    "college_name"      = em."college_name",
    "college_city"      = em."college_city",
    "university"        = em."university",
    "post_grad_college" = em."post_grad_college",
    "post_grad_city"    = em."post_grad_city"
FROM "education_master" em
WHERE pe."education_master_id" = em."id";
