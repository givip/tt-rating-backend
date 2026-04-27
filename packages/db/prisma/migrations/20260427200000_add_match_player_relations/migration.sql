-- AlterTable: add foreign key constraints for Match player relations
ALTER TABLE "Match" ADD CONSTRAINT "Match_player1_id_fkey" FOREIGN KEY ("player1_id") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Match" ADD CONSTRAINT "Match_player2_id_fkey" FOREIGN KEY ("player2_id") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
