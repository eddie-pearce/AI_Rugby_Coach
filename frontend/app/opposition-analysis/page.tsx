"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/apiFetch";
import OppDirectReportView from "@/components/OppositionReportView";
import type { DirectReport } from "@/components/ReportView";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Opponent {
  id: string;
  name: string;
  date: string;
}

interface OppReport {
  id: string;
  report_type: "opp_attack" | "opp_defence";
  report_data: DirectReport | null;
  created_at: string;
}

const API = process.env.NEXT_PUBLIC_API_URL;

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

// ─── Opponent detail ──────────────────────────────────────────────────────────

function OpponentDetail({ opponent }: { opponent: Opponent }) {
  const [tag, setTag] = useState<"opp_attack" | "opp_defence">("opp_attack");
  const [reports, setReports] = useState<OppReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const reportsRes = await fetch(`/api/generate-opposition-report?match_id=${encodeURIComponent(opponent.id)}`);
        if (reportsRes.ok) setReports(await reportsRes.json());
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    }
    load();
  }, [opponent.id]);

  async function handleGenerateReport() {
    setGenerating(true);
    setGenError("");
    const label = tag === "opp_attack" ? "Attack" : "Defence";
    try {
      const res = await fetch("/api/generate-opposition-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ match_id: opponent.id, label }),
      });
      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch {
        throw new Error("The report took too long to generate. Please try again.");
      }
      if (data.noClips) { setGenError(`No analysed opposition ${label.toLowerCase()} clips found.`); return; }
      if (!res.ok) {
        if (data.raw) console.error("AI raw response:", data.raw);
        throw new Error((data.error as string) ?? "Failed to generate report");
      }
      setReports((prev) => {
        const filtered = prev.filter((r) => r.report_type !== tag);
        return [...filtered, data as unknown as OppReport];
      });

    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setGenerating(false);
    }
  }

  const tagReport = reports.find((r) => r.report_type === tag) ?? null;

  return (
    <div>
      {/* Their Attack / Their Defence toggle */}
      <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1 mb-6 w-fit">
        {(["opp_attack", "opp_defence"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTag(t)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              tag === t ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"
            }`}
          >
            {t === "opp_attack" ? "Their Attack" : "Their Defence"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-white/30 text-sm py-10">
          <div className="w-4 h-4 border-2 border-white/20 border-t-white/50 rounded-full animate-spin" />
          Loading…
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-5">
            {tagReport ? (
              <p className="text-white/20 text-xs">
                Generated {new Date(tagReport.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            ) : (
              <p className="text-white/30 text-sm">No scouting report yet.</p>
            )}
            <button
              onClick={handleGenerateReport}
              disabled={generating}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                generating ? "bg-white/10 text-white/30 cursor-not-allowed" : "bg-white text-black hover:brightness-90 cursor-pointer"
              }`}
            >
              {generating ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Generating…
                </>
              ) : tagReport ? "Regenerate" : "Generate Report"}
            </button>
          </div>
          {genError && <p className="text-red-400 text-sm mb-4">{genError}</p>}
          {tagReport?.report_data && <OppDirectReportView report={tagReport.report_data} />}
        </div>
      )}
    </div>
  );
}

// ─── Opposition selector dropdown ─────────────────────────────────────────────

function OppositionDropdown({
  opponents,
  selectedId,
  onSelect,
}: {
  opponents: Opponent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = opponents.find((o) => o.id === selectedId);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full bg-white/10 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-left flex items-center justify-between hover:border-white/25 focus:outline-none focus:border-white/50 transition-colors"
      >
        <span className={selected ? "text-white truncate" : "text-white/30"}>
          {selected ? selected.name : "Select an opposition…"}
        </span>
        <svg
          className={`w-4 h-4 text-white/40 shrink-0 ml-2 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && opponents.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#111] border border-white/15 rounded-xl shadow-2xl z-50 overflow-hidden max-h-64 overflow-y-auto">
          {opponents.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => { onSelect(o.id); setOpen(false); }}
              className={`w-full text-left px-4 py-3 text-sm flex items-center justify-between hover:bg-white/10 transition-colors ${
                selectedId === o.id ? "bg-white/10 text-white" : "text-white/70"
              }`}
            >
              <span className="truncate">{o.name}</span>
              <span className="text-white/30 text-xs shrink-0 ml-3">{formatDate(o.date)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OppositionAnalysisPage() {
  const [opponents, setOpponents] = useState<Opponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchOpponents = useCallback(async () => {
    try {
      const res = await apiFetch(`${API}/opponents`);
      if (res.ok) {
        const data: Opponent[] = await res.json();
        setOpponents(data);
        if (data.length > 0) setSelectedId(data[0].id);
      }
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchOpponents(); }, [fetchOpponents]);

  const selected = opponents.find((o) => o.id === selectedId) ?? null;

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-6xl mx-auto">

        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-bold text-white">Opposition Analysis</h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30">
              Opposition
            </span>
          </div>
          <p className="text-white/40 text-sm mt-1">Select an opposition to generate a scouting report.</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-white/30 text-sm">
            <div className="w-4 h-4 border-2 border-white/20 border-t-white/50 rounded-full animate-spin" />
            Loading…
          </div>
        ) : opponents.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-xl px-5 py-8">
            <p className="text-white/40 text-sm">
              No opposition teams added yet.{" "}
              <a href="/opposition-analysis/clipping" className="text-white/60 underline underline-offset-2 hover:text-white transition-colors">
                Add one in the Clipping section.
              </a>
            </p>
          </div>
        ) : (
          <div className="space-y-6">

            {/* Opposition selector */}
            <div className="max-w-sm">
              <p className="text-white/40 text-xs mb-2">Opposition</p>
              <OppositionDropdown
                opponents={opponents}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </div>

            {/* Detail panel */}
            {selected && (
              <div className="bg-white/3 border border-white/10 rounded-xl p-6">
                <div className="mb-5">
                  <h2 className="text-xl font-bold text-white">{selected.name}</h2>
                  <p className="text-white/40 text-sm mt-0.5">{formatDate(selected.date)}</p>
                </div>
                <OpponentDetail key={selected.id} opponent={selected} />
              </div>
            )}

          </div>
        )}

      </div>
    </main>
  );
}
