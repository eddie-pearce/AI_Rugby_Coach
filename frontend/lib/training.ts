export interface TrainingDrill {
  name: string;
  duration_mins: number;
  reason?: string;
  setup: string | string[];
  key_focus: string | string[];
  progression: string | string[];
  coaching_cues?: string[];
  evidence_link?: string;
  opposition_pattern?: string;
}

export interface TrainingSessionData {
  title: string;
  theme: string;
  duration_mins: number;
  fallback_note?: string;
  warm_up: { name?: string; duration_mins: number; description: string };
  drills: TrainingDrill[];
  scenario_play: { duration_mins: number; description: string };
  coaching_cues?: string[];
  coaching_notes?: string[];
}

export interface TrainingSession {
  id: string;
  created_at: string;
  user_id: string;
  session_report_id: string | null;
  match_id: string;
  report_type: string;
  session_type: "match_fix_it" | "match_structure" | "opposition_prep";
  title: string;
  theme: string | null;
  session_data: TrainingSessionData;
  fallback_note: string | null;
  source_name: string | null;
}

export const SESSION_TYPE_LABELS: Record<TrainingSession["session_type"], string> = {
  match_fix_it:    "Match — Fix It",
  match_structure: "Match — Structure",
  opposition_prep: "Opposition Prep",
};

export const SESSION_TYPE_COLOURS: Record<TrainingSession["session_type"], string> = {
  match_fix_it:    "bg-red-500/15 text-red-400 border-red-500/25",
  match_structure: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  opposition_prep: "bg-orange-500/15 text-orange-400 border-orange-500/25",
};

export function sourceReportHref(reportType: string, matchId: string): string {
  if (reportType.startsWith("opp_")) return `/opposition-analysis/analysis?match_id=${matchId}`;
  return `/match-analysis/analysis?match_id=${matchId}`;
}
