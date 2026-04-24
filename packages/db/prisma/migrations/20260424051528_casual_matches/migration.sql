-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('tournament', 'casual');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MatchStatus" ADD VALUE 'pending_opponent';
ALTER TYPE "MatchStatus" ADD VALUE 'rejected';
ALTER TYPE "MatchStatus" ADD VALUE 'expired';

-- DropForeignKey
ALTER TABLE "matches" DROP CONSTRAINT "matches_tournament_id_fkey";

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "match_type" "MatchType" NOT NULL DEFAULT 'tournament',
ADD COLUMN     "proposer_id" TEXT,
ALTER COLUMN "tournament_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "matches_player1_id_match_type_status_idx" ON "matches"("player1_id", "match_type", "status");

-- CreateIndex
CREATE INDEX "matches_player2_id_match_type_status_idx" ON "matches"("player2_id", "match_type", "status");

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
