"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { formatAnalysisOutput } from "@/lib/formatAnalysis";

type Tag = "attack" | "defence";

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

export default function ClipReviewPage({ tag }: { tag: Tag }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Clip | null>(null);
  const analysisRef = useRef<HTMLPreElement>(null);

  const fetchClips = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`${API}/clips`);
      const data: Clip[] = await res.json();
      setClips(data.filter((c) => c.tag === tag));
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [tag]);

  useEffect(() => { fetchClips(); }, [fetchClips]);

  // Scroll analysis into view when a clip with output is selected
  useEffect(() => {
    if (selected?.analysis_output && analysisRef.current) {
      analysisRef.current.parentElement?.scrollTo({ top: 0 });
    }
  }, [selected]);

  const tagLabel = tag === "attack" ? "Attack" : "Defence";
  const tagColor = tag === "attack" ? "text-green-400 bg-green-500/10" : "text-blue-400 bg-blue-500/10";

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">{tagLabel}</h1>
          <p className="text-white/40 text-sm mt-1">
            Select a clip to review the footage and saved analysis
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">

          {/* LEFT — clip list */}
          <div className="w-full lg:w-64 shrink-0">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-white/40 text-xs font-medium uppercase tracking-wider mb-3">
                {tagLabel} Clips
              </p>

              {loading ? (
                <div className="flex justify-center py-10">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              ) : clips.length === 0 ? (
                <p className="text-white/30 text-sm text-center py-10">
                  No {tag} clips yet.<br />
                  <span className="text-white/20 text-xs">Use the Clipping tool to save some.</span>
                </p>
              ) : (
                <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                  {clips.map((clip) => {
                    const isSelected = selected?.id === clip.id;
                    return (
                      <button
                        key={clip.id}
                        onClick={() => setSelected(clip)}
                        className={`w-full text-left rounded-lg p-3 transition-all border ${
                          isSelected
                            ? "border-white/50 bg-white/5"
                            : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tagColor}`}>
                            {tagLabel}
                          </span>
                          <span className="text-white/30 text-xs font-mono">
                            {dur(clip.start_time, clip.end_time)}
                          </span>
                        </div>
                        {clip.label && (
                          <p className="text-white/80 text-sm font-medium truncate mt-1">{clip.label}</p>
                        )}
                        {clip.analysis_output && (
                          <p className="text-white/60 text-xs mt-1">✓ Analysed</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* CENTRE — video player */}
          <div className="flex-1 min-w-0">
            {!selected ? (
              <div className="flex items-center justify-center h-64 rounded-xl border-2 border-dashed border-white/10">
                <p className="text-white/30 text-sm">← Select a clip</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl overflow-hidden bg-black">
                  <video
                    key={selected.id}
                    src={selected.clip_url}
                    controls
                    className="w-full max-h-[480px] object-contain"
                  />
                </div>
                {selected.label && (
                  <p className="text-white/50 text-sm px-1">{selected.label}</p>
                )}
              </div>
            )}
          </div>

          {/* RIGHT — saved analysis output */}
          <div className="w-full lg:w-80 xl:w-96 shrink-0">
            <div className="bg-white/5 border border-white/10 rounded-xl p-5 lg:max-h-[80vh] lg:overflow-y-auto">
              {!selected ? (
                <p className="text-white/30 text-sm text-center py-10">
                  Select a clip to view its analysis
                </p>
              ) : selected.analysis_output ? (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <span className="inline-block w-5 h-0.5 bg-white" />
                    <h2 className="text-white font-semibold text-sm">{tagLabel} Analysis</h2>
                  </div>
                  <pre
                    ref={analysisRef}
                    className="text-white/80 text-sm leading-7 whitespace-pre-wrap font-sans"
                  >
                    {formatAnalysisOutput(selected.analysis_output)}
                  </pre>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
                  <p className="text-white/30 text-sm">No analysis yet.</p>
                  <p className="text-white/20 text-xs">
                    Go to the Analysis tab to analyse this clip.
                  </p>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}
