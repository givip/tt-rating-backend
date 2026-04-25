-- NOTE: This migration also includes `ALTER COLUMN "updated_at" DROP DEFAULT`
-- statements on six tables (clubs, matches, players, rating_changes,
-- tournament_participants, tournaments, users). These reconcile DEFAULTs that
-- the schema_tidyup migration (20260424150123) added by hand to backfill the
-- new NOT NULL `updated_at` column on existing rows.
--
-- The schema does not request those DEFAULTs — `@updatedAt` is ORM-managed by
-- Prisma at write time. Dropping them aligns the DB with the schema and
-- prevents future `prisma migrate dev` runs from re-detecting drift.
--
-- Application code is unaffected: every Prisma .update()/.create() call sets
-- `updated_at`. Raw-SQL INSERTs that omit `updated_at` will now fail loudly
-- with a NOT NULL violation, which is the correct behavior — a row born
-- without an `updated_at` is almost certainly a bug.

-- AlterEnum
ALTER TYPE "TournamentStatus" ADD VALUE 'prepared';

-- AlterTable
ALTER TABLE "clubs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "bracket_label" TEXT,
ADD COLUMN     "group_letter" TEXT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "players" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "rating_changes" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tournament_participants" ADD COLUMN     "group_letter" TEXT,
ADD COLUMN     "group_rank" INTEGER,
ADD COLUMN     "withdrawn_at" TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN     "bracket_shape" JSONB,
ADD COLUMN     "group_size" INTEGER,
ADD COLUMN     "number_of_tables" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "format" DROP NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "matches_tournament_id_status_round_idx" ON "matches"("tournament_id", "status", "round");
