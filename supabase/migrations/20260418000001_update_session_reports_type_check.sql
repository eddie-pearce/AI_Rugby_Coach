-- Extend the session_reports report_type check constraint to allow opposition report types
ALTER TABLE session_reports DROP CONSTRAINT session_reports_report_type_check;
ALTER TABLE session_reports ADD CONSTRAINT session_reports_report_type_check CHECK (report_type IN ('attack', 'defence', 'opp_attack', 'opp_defence'));
