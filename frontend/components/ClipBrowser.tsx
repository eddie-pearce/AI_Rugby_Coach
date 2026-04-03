"use client";

import { useEffect, useState, useCallback } from "react";

type Tag = "attack" | "defence";

interface Clip {
  id: string;
  clip_path: string;
  clip_url: string;
  start_time: number;
  end_time: number;
  tag: Tag;
  label: string | null;
  created_at: string;
}

const API = process.env.NEXT_PUBLIC_API_URL;

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function dur(start: number, end: number): string {
  return `${(end - start).toFixed(1)}s`;
}

export default function ClipBrowser({ tag }: { tag: Tag }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Clip | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysis, setAnalysis] = useState<string>("");
  const [error, setError] = useState<string>("");

  const fetchClips = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/clips`);
      const data: Clip[] = await res.json();
      setClips(data.filter((c) => c.tag === tag));
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [tag]);

  useEffect(() => {
    fetchClips();
  }, [fetchClips]);

  function selectClip(clip: Clip) {
    setSelected(clip);
    setAnalysis("");
    setError("");
  }

  async function handleAnalyse() {
    if (!selected) return;
    setAnalysing(true);
    setAnalysis("");
    setError("");

    try {
      const res = await fetch(`${API}/analyse/clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clip_path: selected.clip_path, type: tag }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Error ${res.status}`);
      }

      const data = await res.json();
      setAnalysis(data.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setAnalysing(false);
    }
  }

  const tagLabel = tag === "attack" ? "Attack" : "Defence";
  const tagColor = tag === "attack" ? "text-green-400 bg-green-500/10" : "text-blue-400 bg-blue-500/10";

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">{tagLabel} Analysis</h1>
          <p className="text-white/40 text-sm mt-1">Select a saved clip to analyse</p>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">

          {/* LEFT — clip list */}
          <div className="w-full lg:w-72 xl:w-80 shrink-0">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-white/40 text-xs font-medium uppercase tracking-wider mb-3">
                Saved Clips
              </p>

              {loading ? (
                <div className="flex justify-center py-10">
                  <div className="w-6 h-6 border-2 border-amber border-t-transparent rounded-full animate-spin" />
                </div>
              ) : clips.length === 0 ? (
                <p className="text-white/30 text-sm text-center py-10">
                  No {tag} clips saved yet.
                  <br />
                  <span className="text-white/20 text-xs">Use the Clipping tool to create some.</span>
                </p>
              ) : (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                  {clips.map((clip) => {
                    const isSelected = selected?.id === clip.id;
                    return (
                      <button
                        key={clip.id}
                        onClick={() => selectClip(clip)}
                        className={`
                          w-full text-left rounded-lg p-3 transition-all border
                          ${isSelected
                            ? "border-amber/50 bg-amber/5"
                            : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
                          }
                        `}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tagColor}`}>
                            {tagLabel}
                          </span>
                          <span className="text-white/30 text-xs font-mono">
                            {dur(clip.start_time, clip.end_time)}
                          </span>
                        </div>
                        {clip.label && (
                          <p className="text-white/80 text-sm font-medium truncate">{clip.label}</p>
                        )}
                        <p className="text-white/30 text-xs font-mono mt-0.5">
                          {formatTime(clip.start_time)} → {formatTime(clip.end_time)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — analysis panel */}
          <div className="flex-1 min-w-0">
            {!selected ? (
              <div className="flex items-center justify-center h-64 rounded-xl border-2 border-dashed border-white/10">
                <p className="text-white/30 text-sm">← Select a clip to analyse</p>
              </div>
            ) : (
              <div className="space-y-4">

                {/* Selected clip info */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Selected Clip</p>
                      <p className="text-white font-semibold text-base">
                        {selected.label || `${tagLabel} clip`}
                      </p>
                      <p className="text-white/30 text-xs font-mono mt-1">
                        {formatTime(selected.start_time)} → {formatTime(selected.end_time)} · {dur(selected.start_time, selected.end_time)}
                      </p>
                    </div>
                    <button
                      onClick={handleAnalyse}
                      disabled={analysing}
                      className={`
                        shrink-0 px-6 py-2.5 rounded-lg font-semibold text-sm transition-all
                        ${analysing
                          ? "bg-white/10 text-white/30 cursor-not-allowed"
                          : "bg-amber text-navy hover:brightness-110 cursor-pointer"
                        }
                      `}
                    >
                      {analysing ? "Analysing…" : "Analyse"}
                    </button>
                  </div>
                </div>

                {/* Loading spinner */}
                {analysing && (
                  <div className="flex flex-col items-center gap-3 py-10">
                    <div className="w-8 h-8 border-2 border-amber border-t-transparent rounded-full animate-spin" />
                    <p className="text-white/40 text-sm">Analysing clip…</p>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-5 py-4">
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                )}

                {/* Analysis result */}
                {analysis && (
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="inline-block w-6 h-0.5 bg-amber" />
                      <h2 className="text-white font-semibold">{tagLabel} Analysis</h2>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-xl px-6 py-6">
                      <pre className="text-white/85 text-sm leading-7 whitespace-pre-wrap font-sans">
                        {analysis}
                      </pre>
                    </div>
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
