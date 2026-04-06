"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/apiFetch";
import ReportView from "@/components/ReportView";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Match {
  id: string;
  name: string;
  date: string;
}

interface Clip {
  id: string;
  match_id: string | null;
  clip_path: string;
  clip_url: string;
  start_time: number;
  end_time: number;
  tag: "attack" | "defence";
  label: string | null;
  analysis_output: string | null;
  status: "pending" | "analysing" | "complete" | "failed" | null;
  created_at: string;
}

interface WentWellItem { header: string; bullets: string[] }
interface WorkOn { area: string; priority: "high" | "medium"; bullets: string[] }
interface Drill {
  priority_order: number;
  drill_name: string;
  targets: string;
  setup: string;
  key_focus: string;
  progression: string;
}
interface Report {
  id: string;
  report_type: "attack" | "defence";
  overview: string;
  went_well: WentWellItem[];
  work_ons: WorkOn[];
  suggested_drills: Drill[];
  created_at: string;
}

const API = process.env.NEXT_PUBLIC_API_URL;

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function dur(start: number, end: number) {
  return `${(end - start).toFixed(1)}s`;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const TAG_STYLES: Record<string, string> = {
  attack:  "bg-green-500/20 text-green-400 border-green-500/25",
  defence: "bg-blue-500/20 text-blue-400 border-blue-500/25",
};

const STATUS_STYLES: Record<string, string> = {
  pending:   "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
  analysing: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  failed:    "bg-red-500/15 text-red-400 border-red-500/25",
};

function StatusBadge({ status }: { status: Clip["status"] }) {
  if (!status || status === "complete") return null;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border capitalize flex items-center gap-1 ${STATUS_STYLES[status] ?? ""}`}>
      {status === "analysing" && (
        <span className="w-2 h-2 border border-current border-t-transparent rounded-full animate-spin inline-block" />
      )}
      {status}
    </span>
  );
}

// ─── Clip list item ───────────────────────────────────────────────────────────

function ClipListItem({ clip, selected, onClick }: { clip: Clip; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
        selected
          ? "bg-white/10 border-white/30 text-white"
          : "bg-white/3 border-white/8 text-white/60 hover:text-white hover:bg-white/8 hover:border-white/15"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium truncate">
          {clip.label || <span className="italic text-white/30">Unlabelled</span>}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={clip.status} />
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border capitalize ${TAG_STYLES[clip.tag] ?? ""}`}>
            {clip.tag}
          </span>
        </div>
      </div>
      <span className="text-white/30 font-mono text-xs mt-0.5 block">{dur(clip.start_time, clip.end_time)}</span>
    </button>
  );
}

// ─── Match detail ─────────────────────────────────────────────────────────────

function MatchDetail({ match }: { match: Match }) {
  const [tag, setTag] = useState<"attack" | "defence">("attack");
  const [view, setView] = useState<"clips" | "report">("clips");
  const [clips, setClips] = useState<Clip[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [clipsRes, reportsRes] = await Promise.all([
          apiFetch(`${API}/clips?match_id=${match.id}`),
          fetch(`/api/generate-report?match_id=${encodeURIComponent(match.id)}`),
        ]);
        if (clipsRes.ok) setClips(await clipsRes.json());
        if (reportsRes.ok) setReports(await reportsRes.json());
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    }
    load();
  }, [match.id]);

  // Reset selected clip when tag changes
  useEffect(() => { setSelectedClip(null); }, [tag]);

  const tagClips = clips.filter((c) => c.tag === tag);
  const tagReport = reports.find((r) => r.report_type === tag) ?? null;

  return (
    <div>
      {/* Match header */}
      <div className="mb-5">
        <h2 className="text-xl font-bold text-white">{match.name}</h2>
        <p className="text-white/40 text-sm mt-0.5">{formatDate(match.date)}</p>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        {/* Attack / Defence */}
        <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
          {(["attack", "defence"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTag(t)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize transition-all ${
                tag === t ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Clips / Report */}
        <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
          {(["clips", "report"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize transition-all ${
                view === v ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-white/30 text-sm py-10">
          <div className="w-4 h-4 border-2 border-white/20 border-t-white/50 rounded-full animate-spin" />
          Loading…
        </div>
      ) : view === "clips" ? (

        /* ── Clips view ── */
        tagClips.length === 0 ? (
          <p className="text-white/25 text-sm">No {tag} clips for this match.</p>
        ) : (
          <div className="flex gap-4">
            {/* Clip list */}
            <div className="w-52 xl:w-60 shrink-0 space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
              {tagClips.map((clip) => (
                <ClipListItem
                  key={clip.id}
                  clip={clip}
                  selected={selectedClip?.id === clip.id}
                  onClick={() => setSelectedClip(clip)}
                />
              ))}
            </div>

            {/* Video player + analysis */}
            <div className="flex-1 min-w-0">
              {!selectedClip ? (
                <div className="flex items-center justify-center h-48 rounded-xl border-2 border-dashed border-white/10">
                  <p className="text-white/25 text-sm">Select a clip to play</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl overflow-hidden bg-black">
                    <video
                      key={selectedClip.id}
                      src={selectedClip.clip_url}
                      controls
                      autoPlay
                      className="w-full max-h-[380px] object-contain"
                    />
                  </div>
                  {selectedClip.label && (
                    <p className="text-white/50 text-sm px-1">{selectedClip.label}</p>
                  )}
                  {selectedClip.analysis_output && (
                    <div className="bg-white/5 border border-white/10 rounded-xl px-5 py-4">
                      <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">Analysis</p>
                      <pre className="text-white/75 text-sm leading-7 whitespace-pre-wrap font-sans">
                        {selectedClip.analysis_output}
                      </pre>
                    </div>
                  )}
                  {selectedClip.status === "failed" && (
                    <p className="text-red-400 text-sm px-1">Analysis failed for this clip.</p>
                  )}
                  {(selectedClip.status === "pending" || selectedClip.status === "analysing") && (
                    <p className="text-white/40 text-sm px-1">Analysis in progress…</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )

      ) : (

        /* ── Report view ── */
        tagReport ? (
          <div>
            <p className="text-white/20 text-xs mb-5">
              Generated {new Date(tagReport.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
            <ReportView report={tagReport} />
          </div>
        ) : (
          <p className="text-white/25 text-sm">
            No {tag} report generated yet.{" "}
            <a href="/reports" className="text-white/50 underline underline-offset-2 hover:text-white transition-colors">
              Generate one in Reports.
            </a>
          </p>
        )

      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MatchesPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchMatches = useCallback(async () => {
    try {
      const res = await apiFetch(`${API}/matches`);
      if (res.ok) {
        const data: Match[] = await res.json();
        setMatches(data);
        if (data.length > 0) setSelectedId(data[0].id);
      }
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchMatches(); }, [fetchMatches]);

  const selected = matches.find((m) => m.id === selectedId) ?? null;

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-6xl mx-auto">

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Matches</h1>
          <p className="text-white/40 text-sm mt-1">View clips and reports for each match.</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-white/30 text-sm">
            <div className="w-4 h-4 border-2 border-white/20 border-t-white/50 rounded-full animate-spin" />
            Loading matches…
          </div>
        ) : matches.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-xl px-5 py-8">
            <p className="text-white/40 text-sm">
              No matches yet.{" "}
              <a href="/clipping" className="text-white/60 underline underline-offset-2 hover:text-white transition-colors">
                Create one in the Clipping tool.
              </a>
            </p>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6">

            {/* Match list */}
            <div className="w-full lg:w-56 xl:w-64 shrink-0">
              <div className="space-y-1">
                {matches.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className={`w-full text-left px-4 py-3 rounded-xl transition-all border ${
                      selectedId === m.id
                        ? "bg-white/10 border-white/20 text-white"
                        : "bg-white/3 border-white/8 text-white/60 hover:text-white hover:bg-white/8 hover:border-white/15"
                    }`}
                  >
                    <p className="font-semibold text-sm truncate">{m.name}</p>
                    <p className="text-xs mt-0.5 opacity-50">{formatDate(m.date)}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Match detail */}
            <div className="flex-1 min-w-0 bg-white/3 border border-white/10 rounded-xl p-6">
              {selected ? (
                <MatchDetail key={selected.id} match={selected} />
              ) : (
                <p className="text-white/30 text-sm">Select a match to view its clips and reports.</p>
              )}
            </div>

          </div>
        )}

      </div>
    </main>
  );
}
