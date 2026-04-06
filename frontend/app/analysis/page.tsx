"use client";

import { useEffect, useState, useCallback } from "react";
import { readSSE } from "@/lib/sse";
import { apiFetch } from "@/lib/apiFetch";

type Tag = "attack" | "defence";
type Filter = "all" | Tag;

interface Clip {
  id: string;
  clip_path: string;
  clip_url: string;
  start_time: number;
  end_time: number;
  tag: Tag;
  label: string | null;
  analysis_output: string | null;
  created_at: string;
}

const API = process.env.NEXT_PUBLIC_API_URL;

function dur(start: number, end: number) {
  return `${(end - start).toFixed(1)}s`;
}

const tagBadge = (tag: Tag) =>
  tag === "attack"
    ? "bg-green-500/20 text-green-400"
    : "bg-blue-500/20 text-blue-400";

function ClipButton({ clip, selected, onSelect }: {
  clip: Clip;
  selected: Clip | null;
  onSelect: (c: Clip) => void;
}) {
  const isSelected = selected?.id === clip.id;
  return (
    <button
      onClick={() => onSelect(clip)}
      className={`w-full text-left rounded-lg p-3 transition-all border ${
        isSelected
          ? "border-amber/50 bg-amber/5"
          : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${tagBadge(clip.tag)}`}>
          {clip.tag}
        </span>
        <span className="text-white/30 text-xs font-mono">{dur(clip.start_time, clip.end_time)}</span>
      </div>
      {clip.label && <p className="text-white/80 text-sm font-medium truncate">{clip.label}</p>}
    </button>
  );
}

export default function AnalysisPage() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Clip | null>(null);

  const [analysing, setAnalysing] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const fetchClips = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`${API}/clips`);
      const data = await res.json();
      setClips(Array.isArray(data) ? data : []);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchClips(); }, [fetchClips]);

  const filtered = filter === "all" ? clips : clips.filter((c) => c.tag === filter);
  const toAnalyse = filtered.filter(c => !c.analysis_output);
  const analysed = filtered.filter(c => !!c.analysis_output);

  function selectClip(clip: Clip) {
    setSelected(clip);
    setDone(false);
    setError("");
    setStatusMsg("");
  }

  async function handleAnalyse() {
    if (!selected || analysing) return;

    setAnalysing(true);
    setDone(false);
    setError("");
    setStatusMsg("");

    try {
      const res = await apiFetch(`${API}/analyse/clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clip_id: selected.id, clip_path: selected.clip_path }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Error ${res.status}`);
      }

      for await (const event of readSSE(res)) {
        if (event.error) throw new Error(event.error);
        if (event.status) setStatusMsg(event.status);
      }

      setDone(true);
      await fetchClips();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setAnalysing(false);
      setStatusMsg("");
    }
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Analysis</h1>
          <div className="mt-3 flex flex-col gap-1.5">
            {[
              { n: "1", text: "Select a clip from the To Analyse panel on the left." },
              { n: "2", text: "Press Analyse to run AI analysis on that clip." },
              { n: "3", text: "Once complete, the clip moves to the Analysed panel on the right — click it to review the output." },
            ].map(({ n, text }) => (
              <div key={n} className="flex gap-3 items-start">
                <span className="text-white/25 text-xs font-bold w-4 shrink-0 mt-0.5">{n}</span>
                <p className="text-white/50 text-sm">{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-2 mb-6">
          {(["all", "attack", "defence"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                filter === f
                  ? "bg-amber text-navy"
                  : "bg-white/10 text-white/50 hover:text-white hover:bg-white/20"
              }`}
            >
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_280px] gap-6">

          {/* LEFT — To Analyse */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">To Analyse</p>
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 border-2 border-amber border-t-transparent rounded-full animate-spin" />
              </div>
            ) : toAnalyse.length === 0 ? (
              <p className="text-white/25 text-sm text-center py-10">No clips to analyse</p>
            ) : (
              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {toAnalyse.map(clip => (
                  <ClipButton key={clip.id} clip={clip} selected={selected} onSelect={selectClip} />
                ))}
              </div>
            )}
          </div>

          {/* CENTRE — video + analyse */}
          <div className="min-w-0">
            {!selected ? (
              <div className="flex items-center justify-center h-64 rounded-xl border-2 border-dashed border-white/10">
                <p className="text-white/30 text-sm">Select a clip to analyse</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl overflow-hidden bg-black">
                  <video
                    key={selected.id}
                    src={selected.clip_url}
                    controls
                    className="w-full max-h-[480px] object-contain"
                  />
                </div>

                {selected.label && (
                  <p className="text-white/60 text-sm px-1">{selected.label}</p>
                )}

                <button
                  onClick={handleAnalyse}
                  disabled={analysing}
                  className={`w-full py-3 rounded-lg font-semibold text-base transition-all ${
                    analysing
                      ? "bg-white/10 text-white/30 cursor-not-allowed"
                      : "bg-amber text-navy hover:brightness-110 cursor-pointer"
                  }`}
                >
                  {analysing ? "Analysing…" : selected.analysis_output ? "Re-Analyse" : "Analyse"}
                </button>

                {analysing && statusMsg && (
                  <div className="flex items-center gap-3 px-1">
                    <div className="w-4 h-4 border-2 border-amber border-t-transparent rounded-full animate-spin shrink-0" />
                    <p className="text-white/50 text-sm">{statusMsg}</p>
                  </div>
                )}

                {done && (
                  <div className="rounded-xl bg-green-500/10 border border-green-500/20 px-5 py-4">
                    <p className="text-green-400 text-sm font-medium">Analysis complete — clip moved to the Analysed panel.</p>
                  </div>
                )}

                {error && (
                  <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-5 py-4">
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                )}

                {selected.analysis_output && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                    <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">Analysis Output</p>
                    <p className="text-white/80 text-sm whitespace-pre-wrap leading-relaxed">{selected.analysis_output}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT — Analysed */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">Analysed</p>
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 border-2 border-amber border-t-transparent rounded-full animate-spin" />
              </div>
            ) : analysed.length === 0 ? (
              <p className="text-white/25 text-sm text-center py-10">No analysed clips yet</p>
            ) : (
              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {analysed.map(clip => (
                  <ClipButton key={clip.id} clip={clip} selected={selected} onSelect={selectClip} />
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </main>
  );
}
