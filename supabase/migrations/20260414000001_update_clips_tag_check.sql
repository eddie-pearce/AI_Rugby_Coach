-- Extend the clips tag check constraint to allow opposition tags
ALTER TABLE clips DROP CONSTRAINT clips_tag_check;
ALTER TABLE clips ADD CONSTRAINT clips_tag_check CHECK (tag IN ('attack', 'defence', 'opp_attack', 'opp_defence'));
