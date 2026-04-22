"use client";

import { useState, useCallback, useEffect } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { createClient } from "@/lib/supabase/client";
import ReportView, { type StructuredReport } from "@/components/ReportView";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Match {
  id: string;
  name: string;
  date: string;
}

interface Report {
  id: string;
  session_id: string;
  report_type: "attack" | "defence";
  report_data: StructuredReport | null;
  created_at: string;
}

type TabType = "attack" | "defence";

// ─── Tab panel ────────────────────────────────────────────────────────────────

interface TabPanelProps {
  label: "Attack" | "Defence";
  matchId: string;
  report: Report | null;
  loading: boolean;
  noClips: boolean;
  error: string;
  onGenerate: () => void;
}

function TabPanel({ label, matchId, report, loading, noClips, error, onGenerate }: TabPanelProps) {
  const canGenerate = !!matchId && !loading;

  return (
    <div className="space-y-6">
      {/* Action bar */}
      <div className="flex items-center justify-between">
        <div>
          {report && (
            <p className="text-white/30 text-xs">
              Generated {new Date(report.created_at).toLocaleDateString()}
            </p>
          )}
        </div>
        <button
          onClick={onGenerate}
          disabled={!canGenerate}
          className={`px-5 py-2.5 rounded-lg font-semibold text-sm transition-all flex items-center gap-2 ${
            canGenerate
              ? "bg-white text-black hover:brightness-90 cursor-pointer"
              : "bg-white/10 text-white/30 cursor-not-allowed"
          }`}
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Generating…
            </>
          ) : report ? (
            `Regenerate ${label} Report`
          ) : (
            `Generate ${label} Report`
          )}
        </button>
      </div>

      {/* States */}
      {!matchId && (
        <p className="text-white/30 text-sm">Select a match above to get started.</p>
      )}

      {noClips && (
        <div className="rounded-xl bg-white/5 border border-white/10 px-5 py-6">
          <p className="text-white/50 text-sm">
            No {label.toLowerCase()} clips found for this match.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-5 py-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center gap-4 py-16">
          <div className="w-8 h-8 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          <p className="text-white/40 text-sm">The AI is synthesising the match…</p>
        </div>
      )}

      {!loading && report?.report_data && <ReportView report={report.report_data} />}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [teamId, setTeamId] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("attack");
  const [loadingReports, setLoadingReports] = useState(false);

  const [attackReport, setAttackReport] = useState<Report | null>(null);
  const [defenceReport, setDefenceReport] = useState<Report | null>(null);
  const [attackLoading, setAttackLoading] = useState(false);
  const [defenceLoading, setDefenceLoading] = useState(false);
  const [attackNoClips, setAttackNoClips] = useState(false);
  const [defenceNoClips, setDefenceNoClips] = useState(false);
  const [attackError, setAttackError] = useState("");
  const [defenceError, setDefenceError] = useState("");

  // Fetch team profile id on mount
  useEffect(() => {
    async function loadTeamId() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("team_profiles")
        .select("id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (data?.id) setTeamId(data.id);
    }
    loadTeamId();
  }, []);

  // Fetch matches on mount
  useEffect(() => {
    async function loadMatches() {
      try {
        const res = await apiFetch("http://localhost:8000/matches");
        if (!res.ok) throw new Error("Failed to load matches");
        const data: Match[] = await res.json();
        setMatches(data);
      } catch {
        // Non-fatal
      } finally {
        setMatchesLoading(false);
      }
    }
    loadMatches();
  }, []);

  // Load existing reports when a match is selected
  const loadExistingReports = useCallback(async (mid: string) => {
    setLoadingReports(true);
    setAttackReport(null);
    setDefenceReport(null);
    setAttackNoClips(false);
    setDefenceNoClips(false);
    setAttackError("");
    setDefenceError("");

    try {
      const res = await fetch(`/api/generate-report?match_id=${encodeURIComponent(mid)}`);
      if (!res.ok) throw new Error("Failed to load reports");
      const data: Report[] = await res.json();
      const atk = data.find((r) => r.report_type === "attack");
      const def = data.find((r) => r.report_type === "defence");
      if (atk) setAttackReport(atk);
      if (def) setDefenceReport(def);
    } catch {
      // Non-fatal — match just has no reports yet
    } finally {
      setLoadingReports(false);
    }
  }, []);

  function handleMatchChange(matchId: string) {
    setSelectedMatchId(matchId);
    if (matchId) loadExistingReports(matchId);
  }

  async function generateReport(label: "Attack" | "Defence") {
    const isAttack = label === "Attack";
    if (isAttack) {
      setAttackLoading(true);
      setAttackError("");
      setAttackNoClips(false);
    } else {
      setDefenceLoading(true);
      setDefenceError("");
      setDefenceNoClips(false);
    }

    try {
      const res = await fetch("/api/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ match_id: selectedMatchId, label, ...(teamId ? { team_id: teamId } : {}) }),
      });

      const data = await res.json();

      if (data.noClips) {
        if (isAttack) setAttackNoClips(true);
        else setDefenceNoClips(true);
        return;
      }

      if (!res.ok) throw new Error(data.error ?? "Failed to generate report");

      if (isAttack) setAttackReport(data as Report);
      else setDefenceReport(data as Report);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      if (isAttack) setAttackError(msg);
      else setDefenceError(msg);
    } finally {
      if (isAttack) setAttackLoading(false);
      else setDefenceLoading(false);
    }
  }

  const selectedMatch = matches.find((m) => m.id === selectedMatchId);

  const tabs: { key: TabType; label: string }[] = [
    { key: "attack", label: "Attack Report" },
    { key: "defence", label: "Defence Report" },
  ];

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Match Reports</h1>
          <div className="mt-3 flex flex-col gap-1.5">
            {[
              { n: "1", text: "Select a match from the dropdown below." },
              { n: "2", text: "Choose Attack or Defence, then press Generate Report." },
              { n: "3", text: "The AI will synthesise all analysed clips for that match into a full coaching report." },
            ].map(({ n, text }) => (
              <div key={n} className="flex gap-3 items-start">
                <span className="text-white/25 text-xs font-bold w-4 shrink-0 mt-0.5">{n}</span>
                <p className="text-white/50 text-sm">{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Match selector */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-8">
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">Match</p>

          {matchesLoading ? (
            <div className="flex items-center gap-2 text-white/30 text-sm">
              <div className="w-4 h-4 border-2 border-white/20 border-t-white/50 rounded-full animate-spin" />
              Loading matches…
            </div>
          ) : matches.length === 0 ? (
            <p className="text-white/30 text-sm">
              No matches found. Create a match in the Clipping section first.
            </p>
          ) : (
            <select
              value={selectedMatchId}
              onChange={(e) => handleMatchChange(e.target.value)}
              className="w-full bg-white/10 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-white/40 cursor-pointer"
            >
              <option value="" className="bg-zinc-900 text-white/50">Select a match…</option>
              {matches.map((m) => (
                <option key={m.id} value={m.id} className="bg-zinc-900 text-white">
                  {m.name} — {new Date(m.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </option>
              ))}
            </select>
          )}

          {/* Loading reports indicator */}
          {loadingReports && (
            <div className="flex items-center gap-2 text-white/30 text-xs mt-3">
              <div className="w-3 h-3 border border-white/20 border-t-white/50 rounded-full animate-spin" />
              Loading existing reports…
            </div>
          )}

          {/* Active match pill */}
          {selectedMatch && !loadingReports && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-white/30 text-xs">Active match:</span>
              <span className="text-white/60 text-xs font-semibold">{selectedMatch.name}</span>
              <span className="text-white/20 text-xs">·</span>
              <span className="text-white/30 text-xs">
                {new Date(selectedMatch.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white/5 border border-white/10 rounded-xl p-1">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === key
                  ? "bg-white/15 text-white"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "attack" && (
          <TabPanel
            label="Attack"
            matchId={selectedMatchId}
            report={attackReport}
            loading={attackLoading}
            noClips={attackNoClips}
            error={attackError}
            onGenerate={() => generateReport("Attack")}
          />
        )}
        {activeTab === "defence" && (
          <TabPanel
            label="Defence"
            matchId={selectedMatchId}
            report={defenceReport}
            loading={defenceLoading}
            noClips={defenceNoClips}
            error={defenceError}
            onGenerate={() => generateReport("Defence")}
          />
        )}

      </div>
    </main>
  );
}
