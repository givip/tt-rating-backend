-- NOTE: Hand-edited after generation.
-- `DEFAULT CURRENT_TIMESTAMP` was added to every new `updated_at NOT NULL` column so the ALTER succeeds on non-empty tables by backfilling existing rows with `now()`.
-- Prisma's `@updatedAt` is maintained at the ORM layer, so the DB default stays harmless post-migration (covers any raw-SQL inserts that bypass Prisma).
-- If you regenerate this migration with `prisma migrate dev`, re-apply this edit.

/*
  Warnings:

  - You are about to drop the column `import_date` on the `players` table. All the data in the column will be lost.
  - You are about to drop the column `rating_source` on the `players` table. All the data in the column will be lost.
  - You are about to drop the column `source_rating` on the `players` table. All the data in the column will be lost.
  - You are about to drop the column `source_url` on the `players` table. All the data in the column will be lost.
  - Added the required column `updated_at` to the `clubs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `matches` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `players` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `rating_changes` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `tournament_participants` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `tournaments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "clubs" ADD COLUMN     "address" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "players" DROP COLUMN "import_date",
DROP COLUMN "rating_source",
DROP COLUMN "source_rating",
DROP COLUMN "source_url",
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "rating_changes" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "tournament_participants" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMP(3),
ADD COLUMN     "phone_verified_at" TIMESTAMP(3),
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- DropEnum
DROP TYPE "RatingSource";
