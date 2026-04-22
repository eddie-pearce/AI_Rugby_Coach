"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";

const API = "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Match {
  id: string;
  name: string;
  date: string;
}

interface EvidenceClip {
  clip_id: string;
  clip_url: string;
  explanation: string;
  significance_score: number;
}

interface ReportTheme {
  theme: string;
  description: string;
  evidence_clips: EvidenceClip[];
}

interface AutoReport {
  overview: string;
  went_well: ReportTheme[];
  work_on: ReportTheme[];
}

interface JobStatus {
  job_id: string;
  status: "running" | "complete" | "failed";
  current_step: number;
  step_name: string;
  current_chunk: number;
  total_chunks: number;
  clips_detected: number;
  clips_kept: number;
  failed_chunks: { index: number; error: string }[];
  error: string | null;
  attack_report: AutoReport | null;
  defence_report: AutoReport | null;
}

// ── Step labels ────────────────────────────────────────────────────────────────

const STEPS = [
  "Splitting into chunks",
  "Detecting sequences",
  "Classifying sequences",
  "Enriching with knowledge",
  "Generating reports",
];

// ── Sub-components ─────────────────────────────────────────────────────────────

function ProgressPanel({ job }: { job: JobStatus }) {
  const chunkLabel =
    job.total_chunks > 0
      ? `${job.current_chunk} / ${job.total_chunks}`
      : job.current_chunk > 0
      ? String(job.current_chunk)
      : null;

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="space-y-2">
        {STEPS.map((label, i) => {
          const stepNum = i + 1;
          const done = job.current_step > stepNum || job.status === "complete";
          const active = job.current_step === stepNum && job.status === "running";
          return (
            <div key={i} className="flex items-center gap-3">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  done
                    ? "bg-green-500 text-black"
                    : active
                    ? "bg-white text-black"
                    : "bg-white/10 text-white/30"
                }`}
              >
                {done ? "✓" : stepNum}
              </div>
              <span
                className={`text-sm ${
                  done ? "text-white/50" : active ? "text-white font-medium" : "text-white/30"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Current step detail */}
      {job.status === "running" && (
        <div className="bg-white/5 rounded-lg p-4 space-y-1">
          <p className="text-white text-sm font-medium">{job.step_name}</p>
          {chunkLabel && (
            <p className="text-white/50 text-xs">
              {job.current_step === 3 ? "Sequence" : "Chunk"} {chunkLabel}
            </p>
          )}
          {job.clips_detected > 0 && (
            <p className="text-white/40 text-xs">
              {job.clips_kept} / {job.clips_detected} sequences kept
            </p>
          )}
        </div>
      )}

      {/* Failed chunks */}
      {job.failed_chunks.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-2">
          <p className="text-red-400 text-sm font-medium">
            {job.failed_chunks.length} chunk{job.failed_chunks.length > 1 ? "s" : ""} failed
          </p>
          {job.failed_chunks.map((fc) => (
            <p key={fc.index} className="text-red-300/70 text-xs">
              Chunk {fc.index}: {fc.error}
            </p>
          ))}
          <p className="text-white/40 text-xs">Processing continued with remaining chunks.</p>
        </div>
      )}

      {/* Terminal error */}
      {job.status === "failed" && job.error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-red-400 text-sm font-medium">Pipeline failed</p>
          <p className="text-red-300/70 text-xs mt-1">{job.error}</p>
        </div>
      )}
    </div>
  );
}

function EvidenceClipCard({ clip }: { clip: EvidenceClip }) {
  return (
    <div className="bg-white/5 rounded-lg overflow-hidden">
      <video
        src={clip.clip_url}
        controls
        className="w-full aspect-video bg-black"
        preload="metadata"
      />
      <div className="p-3 space-y-1">
        <p className="text-white/70 text-xs leading-snug">{clip.explanation}</p>
        <p className="text-white/30 text-xs">
          Significance {clip.significance_score}/10
        </p>
      </div>
    </div>
  );
}

function ThemeSection({ theme }: { theme: ReportTheme }) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-white font-semibold text-sm">{theme.theme}</h4>
        <p className="text-white/60 text-xs mt-0.5 leading-relaxed">{theme.description}</p>
      </div>
      {theme.evidence_clips.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {theme.evidence_clips.map((ec) => (
            <EvidenceClipCard key={ec.clip_id} clip={ec} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportPanel({ report, label }: { report: AutoReport; label: string }) {
  const accentClass = label === "Attack" ? "text-[#7EE787]" : "text-[#58A6FF]";
  const borderClass = label === "Attack" ? "border-[#7EE787]/20" : "border-[#58A6FF]/20";
  const bgClass = label === "Attack" ? "bg-[#7EE787]/5" : "bg-[#58A6FF]/5";

  return (
    <div className={`rounded-xl border ${borderClass} ${bgClass} p-6 space-y-6`}>
      <h2 className={`text-lg font-bold ${accentClass}`}>{label} Report</h2>

      {/* Overview */}
      <div>
        <p className="text-white/70 text-sm leading-relaxed">{report.overview}</p>
      </div>

      {/* What Went Well */}
      {report.went_well.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-white/90 text-sm font-semibold uppercase tracking-wider">
            What Went Well
          </h3>
          <div className="space-y-6">
            {report.went_well.map((theme, i) => (
              <ThemeSection key={i} theme={theme} />
            ))}
          </div>
        </div>
      )}

      {/* Work On */}
      {report.work_on.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-white/90 text-sm font-semibold uppercase tracking-wider">
            Work On
          </h3>
          <div className="space-y-6">
            {report.work_on.map((theme, i) => (
              <ThemeSection key={i} theme={theme} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AutomatedAnalysisPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchId, setMatchId] = useState("");
  const [ourColour, setOurColour] = useState("");
  const [oppColour, setOppColour] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load matches
  useEffect(() => {
    apiFetch(`${API}/matches`)
      .then((r) => r.json())
      .then(setMatches)
      .catch(() => {});
  }, []);

  // Poll job status
  useEffect(() => {
    if (!jobId) return;

    const poll = async () => {
      try {
        const res = await apiFetch(`${API}/auto-analysis/${jobId}`);
        const data: JobStatus = await res.json();
        setJob(data);
        if (data.status === "complete" || data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // keep polling
      }
    };

    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId]);

  async function handleStart() {
    if (!matchId || !ourColour.trim() || !oppColour.trim() || !videoFile) return;

    setUploading(true);
    setUploadError(null);

    const form = new FormData();
    form.append("video", videoFile);
    form.append("our_colour", ourColour.trim());
    form.append("opp_colour", oppColour.trim());
    form.append("match_id", matchId);

    try {
      const res = await apiFetch(`${API}/auto-analysis/start`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail ?? "Failed to start pipeline");
      }
      const { job_id } = await res.json();
      setJobId(job_id);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Failed to start pipeline");
    } finally {
      setUploading(false);
    }
  }

  function handleReset() {
    if (pollRef.current) clearInterval(pollRef.current);
    setJobId(null);
    setJob(null);
    setVideoFile(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const isReady = matchId && ourColour.trim() && oppColour.trim() && videoFile;

  // ── Setup form ───────────────────────────────────────────────────────────────
  if (!jobId) {
    return (
      <div className="flex-1 p-6 max-w-lg space-y-6">
        <div>
          <h1 className="text-white text-xl font-bold">Automated Analysis</h1>
          <p className="text-white/50 text-sm mt-1">
            Upload a full match video. The pipeline splits, analyses, and generates Attack &amp;
            Defence reports automatically.
          </p>
        </div>

        <div className="space-y-4">
          {/* Match */}
          <div className="space-y-1">
            <label className="text-white/70 text-xs font-medium uppercase tracking-wider">
              Match
            </label>
            <select
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-white/30"
            >
              <option value="">Select a match…</option>
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {m.date}
                </option>
              ))}
            </select>
          </div>

          {/* Kit colours */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-white/70 text-xs font-medium uppercase tracking-wider">
                Our Kit Colour
              </label>
              <input
                type="text"
                placeholder="e.g. red and black"
                value={ourColour}
                onChange={(e) => setOurColour(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30"
              />
            </div>
            <div className="space-y-1">
              <label className="text-white/70 text-xs font-medium uppercase tracking-wider">
                Opposition Kit Colour
              </label>
              <input
                type="text"
                placeholder="e.g. all white"
                value={oppColour}
                onChange={(e) => setOppColour(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30"
              />
            </div>
          </div>

          {/* Video upload */}
          <div className="space-y-1">
            <label className="text-white/70 text-xs font-medium uppercase tracking-wider">
              Full Match Video
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border border-dashed border-white/20 rounded-lg p-6 text-center cursor-pointer hover:border-white/40 transition-colors"
            >
              {videoFile ? (
                <div className="space-y-1">
                  <p className="text-white text-sm font-medium">{videoFile.name}</p>
                  <p className="text-white/40 text-xs">
                    {(videoFile.size / 1024 / 1024 / 1024).toFixed(2)} GB
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-white/50 text-sm">Click to select video</p>
                  <p className="text-white/30 text-xs">MP4 or MOV</p>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,.mp4,.mov"
              className="hidden"
              onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {uploadError && (
            <p className="text-red-400 text-sm">{uploadError}</p>
          )}

          <button
            onClick={handleStart}
            disabled={!isReady || uploading}
            className="w-full py-3 rounded-lg bg-white text-black text-sm font-semibold disabled:opacity-30 hover:bg-white/90 transition-colors"
          >
            {uploading ? "Uploading…" : "Start Analysis"}
          </button>
        </div>
      </div>
    );
  }

  // ── Processing / results ─────────────────────────────────────────────────────
  return (
    <div className="flex-1 p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-xl font-bold">Automated Analysis</h1>
          {job && (
            <p className="text-white/40 text-xs mt-0.5">
              {job.status === "running"
                ? "Pipeline running…"
                : job.status === "complete"
                ? `Complete — ${job.clips_kept} sequences analysed`
                : "Pipeline failed"}
            </p>
          )}
        </div>
        {job && (job.status === "complete" || job.status === "failed") && (
          <button
            onClick={handleReset}
            className="text-white/50 hover:text-white text-sm transition-colors"
          >
            New Analysis
          </button>
        )}
      </div>

      {/* Progress panel — always visible while job exists */}
      {job && (job.status === "running" || job.status === "failed") && (
        <div className="max-w-sm">
          <ProgressPanel job={job} />
        </div>
      )}

      {/* Reports */}
      {job?.status === "complete" && job.attack_report && job.defence_report && (
        <div className="space-y-8">
          {/* Completion summary */}
          {job.failed_chunks.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 max-w-sm">
              <p className="text-yellow-400 text-sm font-medium">
                {job.failed_chunks.length} chunk{job.failed_chunks.length > 1 ? "s" : ""} could not be processed
              </p>
              {job.failed_chunks.map((fc) => (
                <p key={fc.index} className="text-yellow-300/60 text-xs mt-1">
                  Chunk {fc.index}: {fc.error}
                </p>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <ReportPanel report={job.attack_report} label="Attack" />
            <ReportPanel report={job.defence_report} label="Defence" />
          </div>
        </div>
      )}
    </div>
  );
}
