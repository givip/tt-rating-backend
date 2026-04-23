-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('M', 'F');

-- CreateEnum
CREATE TYPE "RatingSource" AS ENUM ('imported_rttf', 'imported_georgia_league', 'imported_rttf_verified', 'native_ttfge', 'estimated', 'manual');

-- CreateEnum
CREATE TYPE "RatingConfidence" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('player', 'organizer', 'referee', 'club_owner', 'admin');

-- CreateEnum
CREATE TYPE "TournamentFormat" AS ENUM ('round_robin', 'single_elim', 'groups_playoff', 'swiss');

-- CreateEnum
CREATE TYPE "MatchFormat" AS ENUM ('bo3', 'bo5', 'bo7');

-- CreateEnum
CREATE TYPE "TournamentCategory" AS ENUM ('open', 'under12', 'under14', 'under16', 'under18', 'women', 'veterans40');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('draft', 'open', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('scheduled', 'in_progress', 'completed', 'disputed');

-- CreateEnum
CREATE TYPE "RatingChangeType" AS ENUM ('tournament', 'manual', 'initial_import');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "password_hash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'player',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_otps" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "first_name_ka" TEXT NOT NULL,
    "last_name_ka" TEXT NOT NULL,
    "first_name_en" TEXT NOT NULL,
    "last_name_en" TEXT NOT NULL,
    "birth_date" TIMESTAMP(3),
    "gender" "Gender" NOT NULL,
    "city" TEXT,
    "club_id" TEXT,
    "photo_url" TEXT,
    "internal_rating" DOUBLE PRECISION NOT NULL DEFAULT 1500,
    "rd" DOUBLE PRECISION NOT NULL DEFAULT 350,
    "rating_source" "RatingSource" NOT NULL DEFAULT 'native_ttfge',
    "rating_confidence" "RatingConfidence" NOT NULL DEFAULT 'low',
    "provisional" BOOLEAN NOT NULL DEFAULT true,
    "tournaments_played" INTEGER NOT NULL DEFAULT 0,
    "rttf_id" TEXT,
    "rttf_verified_at" TIMESTAMP(3),
    "rttf_verified_by" TEXT,
    "source_rating" DOUBLE PRECISION,
    "source_url" TEXT,
    "import_date" TIMESTAMP(3),
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clubs" (
    "id" TEXT NOT NULL,
    "name_ka" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournaments" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "organizer_id" TEXT NOT NULL,
    "club_id" TEXT,
    "venue_name" TEXT,
    "address" TEXT,
    "city" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "format" "TournamentFormat" NOT NULL,
    "matchFormat" "MatchFormat" NOT NULL DEFAULT 'bo5',
    "has_third_place_match" BOOLEAN NOT NULL DEFAULT false,
    "category" "TournamentCategory" NOT NULL DEFAULT 'open',
    "min_rating" DOUBLE PRECISION,
    "max_rating" DOUBLE PRECISION,
    "max_participants" INTEGER,
    "online_registration" BOOLEAN NOT NULL DEFAULT false,
    "registration_deadline" TIMESTAMP(3),
    "status" "TournamentStatus" NOT NULL DEFAULT 'draft',
    "participants_count" INTEGER NOT NULL DEFAULT 0,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_participants" (
    "tournament_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "seed" INTEGER,
    "final_position" INTEGER,
    "rating_before" DOUBLE PRECISION NOT NULL,
    "rd_before" DOUBLE PRECISION NOT NULL,
    "rating_after" DOUBLE PRECISION,
    "rd_after" DOUBLE PRECISION,
    "rating_delta_display" INTEGER,

    CONSTRAINT "tournament_participants_pkey" PRIMARY KEY ("tournament_id","player_id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "player1_id" TEXT NOT NULL,
    "player2_id" TEXT NOT NULL,
    "winner_id" TEXT,
    "sets_player1" INTEGER,
    "sets_player2" INTEGER,
    "score_details" JSONB,
    "match_weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "played_at" TIMESTAMP(3),
    "entered_by" TEXT,
    "status" "MatchStatus" NOT NULL DEFAULT 'scheduled',

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating_changes" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "tournament_id" TEXT,
    "rating_before" DOUBLE PRECISION NOT NULL,
    "rating_after" DOUBLE PRECISION NOT NULL,
    "rd_before" DOUBLE PRECISION NOT NULL,
    "rd_after" DOUBLE PRECISION NOT NULL,
    "change_type" "RatingChangeType" NOT NULL,
    "formula_version" TEXT NOT NULL,
    "coefficients_snapshot" JSONB NOT NULL,
    "reason" TEXT,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating_snapshots" (
    "player_id" TEXT NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "rd" DOUBLE PRECISION NOT NULL,
    "rank_overall" INTEGER,
    "rank_category" INTEGER,

    CONSTRAINT "rating_snapshots_pkey" PRIMARY KEY ("player_id","snapshot_date")
);

-- CreateTable
CREATE TABLE "rating_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rating_config_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "auth_otps_phone_created_at_idx" ON "auth_otps"("phone", "created_at");

-- CreateIndex
CREATE INDEX "login_attempts_identifier_created_at_idx" ON "login_attempts"("identifier", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "players_user_id_key" ON "players"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "players_rttf_id_key" ON "players"("rttf_id");

-- CreateIndex
CREATE INDEX "players_internal_rating_idx" ON "players"("internal_rating");

-- CreateIndex
CREATE INDEX "players_first_name_en_last_name_en_idx" ON "players"("first_name_en", "last_name_en");

-- CreateIndex
CREATE INDEX "players_first_name_ka_last_name_ka_idx" ON "players"("first_name_ka", "last_name_ka");

-- CreateIndex
CREATE INDEX "tournaments_status_idx" ON "tournaments"("status");

-- CreateIndex
CREATE INDEX "tournaments_starts_at_idx" ON "tournaments"("starts_at");

-- CreateIndex
CREATE INDEX "matches_tournament_id_idx" ON "matches"("tournament_id");

-- CreateIndex
CREATE INDEX "matches_player1_id_idx" ON "matches"("player1_id");

-- CreateIndex
CREATE INDEX "matches_player2_id_idx" ON "matches"("player2_id");

-- CreateIndex
CREATE INDEX "rating_changes_player_id_created_at_idx" ON "rating_changes"("player_id", "created_at");

-- CreateIndex
CREATE INDEX "rating_snapshots_snapshot_date_idx" ON "rating_snapshots"("snapshot_date");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_rttf_verified_by_fkey" FOREIGN KEY ("rttf_verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_entered_by_fkey" FOREIGN KEY ("entered_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_snapshots" ADD CONSTRAINT "rating_snapshots_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_config" ADD CONSTRAINT "rating_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

