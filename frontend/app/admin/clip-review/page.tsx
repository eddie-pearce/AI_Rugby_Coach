"use client";

/**
 * Admin Clip Review — /admin/clip-review
 *
 * Internal spot-check view. No auth required.
 * Loads all clips from the most recent session ordered by significance_score desc.
 * Displays classification badge, scores, themes, descriptions, observations,
 * and an inline video player for the selected clip.
 */

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Clip {
  id: string;
  match_id: string | null;
  clip_url: string;
  // clip_path is the Supabase storage path used to generate signed URLs
  clip_path: string;
  start_time: number;
  end_time: number;
  tag: string;
  label: string | null;
  analysis_output: string | null;
  status: string | null;
  created_at: string;
  // These fields are stored in analysis_output as JSON for automated clips
  relevancy_score?: number;
  significance_score?: number;
  tactical_themes?: string[];
  raw_description?: string;
  observations?: string[];
  classification?: string;
}

interface ParsedClip extends Clip {
  relevancy_score: number;
  significance_score: number;
  tactical_themes: string[];
  raw_description: string;
  observations: string[];
  classification: string;
}

interface Match {
  id: string;
  name: string;
  date: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseClip(clip: Clip): ParsedClip {
  // Automated pipeline stores enrichment data in analysis_output as newline-joined text.
  // We also look at the tag field for classification.
  let significance_score = 5;
  let relevancy_score = 5;
  let tactical_themes: string[] = [];
  let raw_description = "";
  let observations: string[] = [];

  try {
    if (clip.analysis_output) {
      // Try JSON parse first (future-proofing)
      const parsed = JSON.parse(clip.analysis_output);
      significance_score = parsed.significance_score ?? 5;
      relevancy_score = parsed.relevancy_score ?? 5;
      tactical_themes = parsed.tactical_themes ?? [];
      raw_description = parsed.raw_description ?? "";
      observations = parsed.observations ?? [];
    }
  } catch {
    // Fallback: plain text stored as observations joined by newlines
    observations = clip.analysis_output ? clip.analysis_output.split("\n").filter(Boolean) : [];
  }

  const classification =
    clip.tag === "attack" ? "OUR_ATTACK"
    : clip.tag === "defence" ? "OUR_DEFENCE"
    : "DISCARD";

  return {
    ...clip,
    classification,
    significance_score,
    relevancy_score,
    tactical_themes,
    raw_description,
    observations,
  };
}

// ── Badge ──────────────────────────────────────────────────────────────────────

function ClassificationBadge({ classification }: { classification: string }) {
  const styles: Record<string, string> = {
    OUR_ATTACK: "bg-green-100 text-green-800 border border-green-300",
    OUR_DEFENCE: "bg-blue-100 text-blue-800 border border-blue-300",
    DISCARD: "bg-gray-100 text-gray-500 border border-gray-300",
  };
  const labels: Record<string, string> = {
    OUR_ATTACK: "Our Attack",
    OUR_DEFENCE: "Our Defence",
    DISCARD: "Discard",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${styles[classification] ?? styles.DISCARD}`}>
      {labels[classification] ?? classification}
    </span>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ClipReviewPage() {
  const supabase = createClient();
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string>("");
  const [clips, setClips] = useState<ParsedClip[]>([]);
  const [selectedClip, setSelectedClip] = useState<ParsedClip | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Change 1: signed URL state — generated per-clip on selection so private
  // buckets work. Raw clip_url is not used in the player directly.
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [signedUrlError, setSignedUrlError] = useState<string | null>(null);
  const [signedUrlLoading, setSignedUrlLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Load available matches on mount
  useEffect(() => {
    supabase
      .from("matches")
      .select("id, name, date")
      .order("date", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error) { setError(error.message); return; }
        const m = (data ?? []) as Match[];
        setMatches(m);
        if (m.length > 0) setSelectedMatchId(m[0].id);
      });
  }, []);

  // Load clips whenever selected match changes
  useEffect(() => {
    if (!selectedMatchId) return;
    setLoading(true);
    setClips([]);
    setSelectedClip(null);
    setSignedUrl(null);
    setSignedUrlError(null);
    setError(null);

    supabase
      .from("clips")
      .select("*")
      .eq("match_id", selectedMatchId)
      .eq("match_path", "auto")     // automated pipeline clips only
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        setLoading(false);
        if (error) { setError(error.message); return; }
        const parsed = ((data ?? []) as Clip[])
          .map(parseClip)
          .sort((a, b) => b.significance_score - a.significance_score);
        setClips(parsed);
      });
  }, [selectedMatchId]);

  // Change 1: generate a signed URL whenever the selected clip changes.
  // clip_path holds the storage path (e.g. "clips/abc123.mp4").
  // Valid for 1 hour (3600s) — sufficient for a review session.
  // The bucket name matches what the pipeline writes to: "match-clips".
  useEffect(() => {
    if (!selectedClip) {
      setSignedUrl(null);
      setSignedUrlError(null);
      return;
    }

    const storagePath = selectedClip.clip_path;
    if (!storagePath) {
      setSignedUrlError("No storage path found for this clip.");
      setSignedUrl(null);
      return;
    }

    setSignedUrlLoading(true);
    setSignedUrl(null);
    setSignedUrlError(null);

    supabase.storage
      .from("match-clips")
      .createSignedUrl(storagePath, 3600)
      .then(({ data, error }) => {
        setSignedUrlLoading(false);
        if (error || !data?.signedUrl) {
          setSignedUrlError(
            `Could not generate a signed URL for this clip: ${error?.message ?? "unknown error"}. ` +
            `Check that the bucket is accessible and the storage path is correct.`
          );
          return;
        }
        setSignedUrl(data.signedUrl);
      });
  }, [selectedClip]);

  // Reload the video element when the signed URL changes
  useEffect(() => {
    if (videoRef.current && signedUrl) {
      videoRef.current.load();
    }
  }, [signedUrl]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Admin — Clip Review</h1>
          <p className="text-gray-400 text-sm mt-1">
            Internal spot-check view. Clips ordered by significance score descending.
          </p>
        </div>

        {/* Match selector */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-400 mb-1">Session</label>
          <select
            value={selectedMatchId}
            onChange={(e) => setSelectedMatchId(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm w-72"
          >
            {matches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {m.date}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900/40 border border-red-700 rounded text-red-300 text-sm">
            {error}
          </div>
        )}

        {loading && (
          <p className="text-gray-500 text-sm">Loading clips…</p>
        )}

        {!loading && clips.length === 0 && !error && (
          <p className="text-gray-500 text-sm">No automated clips found for this session.</p>
        )}

        <div className="flex gap-6">

          {/* Clip list */}
          <div className="w-96 flex-shrink-0 space-y-2 overflow-y-auto max-h-[80vh] pr-1">
            {clips.map((clip, idx) => (
              <button
                key={clip.id}
                onClick={() => setSelectedClip(clip)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedClip?.id === clip.id
                    ? "bg-gray-700 border-gray-500"
                    : "bg-gray-900 border-gray-800 hover:bg-gray-800"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">#{idx}</span>
                  <ClassificationBadge classification={clip.classification} />
                </div>
                <div className="flex gap-3 text-xs text-gray-400 mb-2">
                  <span>Relevancy: <span className="text-white font-medium">{clip.relevancy_score}/10</span></span>
                  <span>Significance: <span className="text-white font-medium">{clip.significance_score}/10</span></span>
                </div>
                {clip.tactical_themes.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {clip.tactical_themes.map((t) => (
                      <span key={t} className="text-xs bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Detail panel */}
          {selectedClip ? (
            <div className="flex-1 space-y-4">

              {/* Video player — uses signed URL, not raw clip_url */}
              <div className="bg-gray-900 rounded-lg overflow-hidden border border-gray-800">
                {signedUrlLoading && (
                  <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
                    Generating secure video link…
                  </div>
                )}
                {signedUrlError && (
                  <div className="p-4 text-red-400 text-sm bg-red-950/40 border-b border-red-800">
                    ⚠ {signedUrlError}
                  </div>
                )}
                {signedUrl && (
                  <video
                    ref={videoRef}
                    src={signedUrl}
                    controls
                    className="w-full max-h-96 bg-black"
                  />
                )}
              </div>

              {/* Meta */}
              <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <ClassificationBadge classification={selectedClip.classification} />
                  <span className="text-sm text-gray-400">
                    {selectedClip.start_time.toFixed(1)}s – {selectedClip.end_time.toFixed(1)}s
                    &nbsp;({(selectedClip.end_time - selectedClip.start_time).toFixed(1)}s)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-gray-500 text-xs mb-0.5">Relevancy score</p>
                    <p className="text-white font-semibold">{selectedClip.relevancy_score} / 10</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs mb-0.5">Significance score</p>
                    <p className="text-white font-semibold">{selectedClip.significance_score} / 10</p>
                  </div>
                </div>
                {selectedClip.tactical_themes.length > 0 && (
                  <div>
                    <p className="text-gray-500 text-xs mb-1">Tactical themes</p>
                    <div className="flex flex-wrap gap-1">
                      {selectedClip.tactical_themes.map((t) => (
                        <span key={t} className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-gray-200">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Raw description */}
              {selectedClip.raw_description && (
                <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Raw Description</p>
                  <p className="text-sm text-gray-300 leading-relaxed">{selectedClip.raw_description}</p>
                </div>
              )}

              {/* Observations */}
              {selectedClip.observations.length > 0 && (
                <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Observations</p>
                  <ul className="space-y-2">
                    {selectedClip.observations.map((obs, i) => (
                      <li key={i} className="text-sm text-gray-300 flex gap-2">
                        <span className="text-gray-600 flex-shrink-0">—</span>
                        <span>{obs}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
              Select a clip to review
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
