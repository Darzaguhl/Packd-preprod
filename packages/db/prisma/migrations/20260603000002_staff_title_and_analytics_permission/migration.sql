-- Display titles for staff roles
ALTER TABLE "Instructor" ADD COLUMN "title" TEXT;
ALTER TABLE "Member"     ADD COLUMN "staffTitle" TEXT;
