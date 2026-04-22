CREATE TABLE IF NOT EXISTS training_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_report_id uuid,          -- soft ref to session_reports.id
  match_id          uuid NOT NULL, -- the match/opponent row this is linked to
  report_type       text NOT NULL, -- 'attack' | 'defence' | 'opp_attack' | 'opp_defence'
  session_type      text NOT NULL CHECK (session_type IN ('match_fix_it', 'match_structure', 'opposition_prep')),
  title             text NOT NULL,
  theme             text,
  session_data      jsonb NOT NULL DEFAULT '{}',
  fallback_note     text,
  source_name       text          -- display label e.g. "vs Bristol Bears — Attack"
);

ALTER TABLE training_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own training sessions"
  ON training_sessions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
