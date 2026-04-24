-- DropForeignKey
ALTER TABLE "matches" DROP CONSTRAINT "matches_tournament_id_fkey";

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
