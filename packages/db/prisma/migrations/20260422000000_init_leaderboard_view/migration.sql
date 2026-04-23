-- This migration is applied manually after the initial Prisma migration
-- It creates the materialized view for the leaderboard
CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard AS
  SELECT
    p.id,
    p.first_name_ka,
    p.last_name_ka,
    p.first_name_en,
    p.last_name_en,
    p.internal_rating,
    p.rd,
    p.provisional,
    p.tournaments_played,
    p.city,
    p.club_id,
    ROW_NUMBER() OVER (ORDER BY p.internal_rating DESC) AS rank_overall
  FROM players p
  WHERE p.is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_id_idx ON leaderboard(id);
