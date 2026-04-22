-- Add match_type column to distinguish self-analysis matches from opposition scouts
ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_type TEXT NOT NULL DEFAULT 'match';

-- Index for filtering
CREATE INDEX IF NOT EXISTS matches_match_type_idx ON matches (match_type);
