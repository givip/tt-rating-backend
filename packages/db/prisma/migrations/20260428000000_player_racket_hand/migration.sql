-- CreateEnum
CREATE TYPE "PlayingHand" AS ENUM ('left', 'right');

-- AlterTable
ALTER TABLE "players" ADD COLUMN "racket" VARCHAR(80);
ALTER TABLE "players" ADD COLUMN "playing_hand" "PlayingHand";
