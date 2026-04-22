-- Migration: add raw_description and observations columns to clips
-- These were previously stored inside the analysis_output text field as JSON.
-- Promoting them to dedicated columns makes them queryable and simplifies
-- the frontend — no JSON parsing needed for these key fields.
--
-- Run this in the Supabase SQL editor or via the Supabase CLI.
-- Safe to run multiple times (uses IF NOT EXISTS / WHERE NULL guard).

-- Step 1: Add the new columns if they don't already exist
ALTER TABLE clips
  ADD COLUMN IF NOT EXISTS raw_description text,
  ADD COLUMN IF NOT EXISTS observations    jsonb;

-- Step 2: Backfill raw_description from analysis_output JSON.
-- Only touches rows where analysis_output is valid JSON containing the field
-- and raw_description has not yet been populated.
UPDATE clips
SET raw_description = analysis_output::jsonb->>'raw_description'
WHERE
  analysis_output IS NOT NULL
  AND raw_description IS NULL
  AND analysis_output ~ '^\s*\{'          -- rough check: looks like a JSON object
  AND analysis_output::jsonb ? 'raw_description';

-- Step 3: Backfill observations from analysis_output JSON.
-- Stored as a jsonb array (e.g. ["obs 1", "obs 2"]).
-- Only touches rows where analysis_output is valid JSON containing the field
-- and observations has not yet been populated.
UPDATE clips
SET observations = analysis_output::jsonb->'observations'
WHERE
  analysis_output IS NOT NULL
  AND observations IS NULL
  AND analysis_output ~ '^\s*\{'
  AND analysis_output::jsonb ? 'observations';

-- Note: rows where analysis_output is plain text (old pipeline format) will
-- not be backfilled — raw_description and observations remain null for those.
-- This is intentional: the old format didn't have structured fields.
