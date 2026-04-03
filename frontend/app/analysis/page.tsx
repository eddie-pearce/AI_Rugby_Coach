"use client";

import { useEffect, useState, useCallback } from "react";
import { readSSE } from "@/lib/sse";

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
      const res = await fetch(`${API}/clips`);
      setClips(await res.json());
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchClips(); }, [fetchClips]);

  const filtered = filter === "all" ? clips : clips.filter((c) => c.tag === filter);

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
      const res = await fetch(`${API}/analyse/clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clip_id: selected.id, clip_path: selected.clip_path }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Error ${res.status}`);
      }

      // Read the stream for status updates — output is saved server-side
      for await (const event of readSSE(res)) {
        if (event.error) throw new Error(event.error);
        if (event.status) setStatusMsg(event.status);
      }

      setDone(true);
      // Refresh clip list so analysis_output is up to date
      await fetchClips();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setAnalysing(false);
      setStatusMsg("");
    }
  }

  const tagBadge = (tag: Tag) =>
    tag === "attack"
      ? "bg-green-500/20 text-green-400"
      : "bg-blue-500/20 text-blue-400";

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Analysis</h1>
          <p className="text-white/40 text-sm mt-1">Select a clip and run AI analysis</p>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">

          {/* LEFT — clip list with filter */}
          <div className="w-full lg:w-72 shrink-0">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">

              {/* Filter buttons */}
              <div className="flex gap-2 mb-4">
                {(["all", "attack", "defence"] as Filter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                      filter === f
                        ? "bg-amber text-navy"
                        : "bg-white/10 text-white/50 hover:text-white hover:bg-white/20"
                    }`}
                  >
                    {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>

              {loading ? (
                <div className="flex justify-center py-10">
                  <div className="w-6 h-6 border-2 border-amber border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-white/30 text-sm text-center py-10">
                  No clips found.<br />
                  <span className="text-white/20 text-xs">Use the Clipping tool to create some.</span>
                </p>
              ) : (
                <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
                  {filtered.map((clip) => {
                    const isSelected = selected?.id === clip.id;
                    return (
                      <button
                        key={clip.id}
                        onClick={() => selectClip(clip)}
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
                          <span className="text-white/30 text-xs font-mono">
                            {dur(clip.start_time, clip.end_time)}
                          </span>
                        </div>
                        {clip.label && (
                          <p className="text-white/80 text-sm font-medium truncate">{clip.label}</p>
                        )}
                        {clip.analysis_output && (
                          <p className="text-amber/60 text-xs mt-1">✓ Analysed</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* CENTRE — video player + analyse */}
          <div className="flex-1 min-w-0">
            {!selected ? (
              <div className="flex items-center justify-center h-64 rounded-xl border-2 border-dashed border-white/10">
                <p className="text-white/30 text-sm">← Select a clip to analyse</p>
              </div>
            ) : (
              <div className="space-y-4">

                {/* Video player */}
                <div className="rounded-xl overflow-hidden bg-black">
                  <video
                    key={selected.id}
                    src={selected.clip_url}
                    controls
                    className="w-full max-h-[480px] object-contain"
                  />
                </div>

                {/* Clip label */}
                {selected.label && (
                  <p className="text-white/60 text-sm px-1">{selected.label}</p>
                )}

                {/* Analyse button */}
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

                {/* Status while analysing */}
                {analysing && statusMsg && (
                  <div className="flex items-center gap-3 px-1">
                    <div className="w-4 h-4 border-2 border-amber border-t-transparent rounded-full animate-spin shrink-0" />
                    <p className="text-white/50 text-sm">{statusMsg}</p>
                  </div>
                )}

                {/* Success message */}
                {done && (
                  <div className="rounded-xl bg-green-500/10 border border-green-500/20 px-5 py-4">
                    <p className="text-green-400 text-sm font-medium">
                      Analysis complete — view results in the{" "}
                      <span className="capitalize">{selected.tag}</span> tab.
                    </p>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-5 py-4">
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                )}

              </div>
            )}
          </div>

        </div>
      </div>
    </main>
  );
}
