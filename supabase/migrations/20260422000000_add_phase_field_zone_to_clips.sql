-- Add phase and field_zone to clips table for manual coaching metadata
-- These are selected by the coach at clip time, not inferred by AI

ALTER TABLE clips
  ADD COLUMN IF NOT EXISTS phase text,
  ADD COLUMN IF NOT EXISTS field_zone text;
