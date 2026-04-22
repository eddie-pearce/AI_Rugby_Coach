-- Add hierarchical report_data column to session_reports.
-- New reports store the full Report→Phase→Subsection→TacticalTheme→Clips tree here.
-- Old flat columns (went_well, work_ons, etc.) are kept for backward compatibility.
ALTER TABLE session_reports ADD COLUMN IF NOT EXISTS report_data jsonb;
