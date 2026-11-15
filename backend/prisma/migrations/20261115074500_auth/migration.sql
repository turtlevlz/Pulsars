-- Authentication (docs/plan.md, Later phases): a login identifier on users, and a counter
-- that invalidates old tokens when the password changes.

-- AlterTable: email starts nullable so existing rows can be given one.
ALTER TABLE "users" ADD COLUMN "email" TEXT;
ALTER TABLE "users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;

-- Existing accounts get a placeholder login derived from their id (change it afterwards).
UPDATE "users" SET "email" = 'user' || "id" || '@pulsars.local';

-- The development seed accounts get their intended logins. Only the first account of each
-- name is renamed, so a duplicate name can never break the unique index below.
UPDATE "users" SET "email" = 'medic@pulsars.local'
WHERE "name" = 'Dr. Medic' AND "id" = (SELECT MIN("id") FROM "users" WHERE "name" = 'Dr. Medic');
UPDATE "users" SET "email" = 'alice@pulsars.local'
WHERE "name" = 'Alice Patient' AND "id" = (SELECT MIN("id") FROM "users" WHERE "name" = 'Alice Patient');
UPDATE "users" SET "email" = 'bob@pulsars.local'
WHERE "name" = 'Bob Patient' AND "id" = (SELECT MIN("id") FROM "users" WHERE "name" = 'Bob Patient');

ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
