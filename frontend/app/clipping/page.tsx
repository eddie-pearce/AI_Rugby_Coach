"use client";

import { useRef, useState, DragEvent, ChangeEvent, useEffect, useCallback } from "react";

type Tag = "attack" | "defence";

interface Clip {
  id: string;
  match_path: string;
  clip_path: string;
  clip_url: string;
  start_time: number;
  end_time: number;
  tag: Tag;
  label: string | null;
  created_at: string;
}

const API = process.env.NEXT_PUBLIC_API_URL;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
}

function dur(start: number, end: number): string {
  return `${(end - start).toFixed(1)}s`;
}

// ffmpeg.wasm CDN URLs (single-threaded, no SharedArrayBuffer / COOP headers needed)
const FFMPEG_CORE_URL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js";
const FFMPEG_WASM_URL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm";

export default function ClippingPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ffmpegRef = useRef<any>(null);

  const [dragging, setDragging] = useState(false);

  // Upload pipeline state
  const [phase, setPhase] = useState<"idle" | "loading-ffmpeg" | "compressing" | "uploading" | "ready">("idle");
  const [compressionProgress, setCompressionProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");

  const [videoUrl, setVideoUrl] = useState<string | null>(null);  // local blob URL for playback
  const [matchPath, setMatchPath] = useState<string | null>(null); // set after upload completes

  const [markIn, setMarkIn] = useState<number | null>(null);
  const [markOut, setMarkOut] = useState<number | null>(null);
  const [tag, setTag] = useState<Tag | null>(null);
  const [label, setLabel] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [clips, setClips] = useState<Clip[]>([]);
  const [loadingClips, setLoadingClips] = useState(true);

  const fetchClips = useCallback(async () => {
    try {
      const res = await fetch(`${API}/clips`);
      const data = await res.json();
      setClips(data);
    } catch {
      // silently fail
    } finally {
      setLoadingClips(false);
    }
  }, []);

  useEffect(() => { fetchClips(); }, [fetchClips]);

  async function ensureFfmpeg() {
    if (ffmpegRef.current) return ffmpegRef.current;

    setPhase("loading-ffmpeg");
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");

    const ffmpeg = new FFmpeg();
    ffmpeg.on("progress", ({ progress }: { progress: number }) => {
      setCompressionProgress(Math.round(Math.min(progress, 1) * 100));
    });

    await ffmpeg.load({
      coreURL: await toBlobURL(FFMPEG_CORE_URL, "text/javascript"),
      wasmURL: await toBlobURL(FFMPEG_WASM_URL, "application/wasm"),
    });

    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  }

  async function handleUpload(file: File) {
    setUploadError("");
    setMarkIn(null);
    setMarkOut(null);
    setVideoUrl(null);
    setMatchPath(null);

    try {
      // Step 1: Load ffmpeg.wasm (cached after first use)
      const ffmpeg = await ensureFfmpeg();
      const { fetchFile } = await import("@ffmpeg/util");

      // Step 2: Compress client-side to 720p
      setPhase("compressing");
      setCompressionProgress(0);

      await ffmpeg.writeFile("input.mp4", await fetchFile(file));
      await ffmpeg.exec([
        "-i", "input.mp4",
        "-vf", "scale=-2:720",
        "-b:v", "2000k",
        "-c:v", "libx264",
        "-preset", "fast",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "output.mp4",
      ]);

      const outputData = await ffmpeg.readFile("output.mp4") as Uint8Array;
      const blob = new Blob([outputData.buffer], { type: "video/mp4" });

      // Step 3: Show video immediately via local blob URL
      const localUrl = URL.createObjectURL(blob);
      setVideoUrl(localUrl);

      // Step 4: Upload compressed file to backend in the background
      setPhase("uploading");
      const compressedFile = new File([blob], file.name, { type: "video/mp4" });
      const formData = new FormData();
      formData.append("file", compressedFile);

      const res = await fetch(`${API}/upload/match`, { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setMatchPath(data.storage_path);
      setPhase("ready");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Something went wrong during upload.");
      setPhase("idle");
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) { e.preventDefault(); setDragging(true); }
  function handleDragLeave() { setDragging(false); }
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".mp4") || file.name.endsWith(".mov"))) handleUpload(file);
  }
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  }

  function markCurrentTime(which: "in" | "out") {
    const t = videoRef.current?.currentTime ?? 0;
    if (which === "in") setMarkIn(t);
    else setMarkOut(t);
  }

  async function handleSave() {
    if (!matchPath || markIn === null || markOut === null || !tag) return;
    if (markOut <= markIn) { setSaveError("Mark Out must be after Mark In."); return; }

    setSaving(true);
    setSaveSuccess(false);
    setSaveError("");

    try {
      const res = await fetch(`${API}/clips/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ match_path: matchPath, start_time: markIn, end_time: markOut, tag, label }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Save failed");
      }
      setSaveSuccess(true);
      setMarkIn(null);
      setMarkOut(null);
      setLabel("");
      await fetchClips();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  function resetVideo() {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    setMatchPath(null);
    setMarkIn(null);
    setMarkOut(null);
    setPhase("idle");
  }

  const isProcessing = phase === "loading-ffmpeg" || phase === "compressing" || phase === "uploading";
  const canSave = matchPath && markIn !== null && markOut !== null && tag && !saving;

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Clipping Tool</h1>
          <p className="text-white/40 text-sm mt-1">Upload a match, mark sequences, save clips</p>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">

          {/* LEFT PANEL */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* Upload / compression area */}
            {!videoUrl && (
              <div
                onClick={() => !isProcessing && inputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`
                  rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors
                  ${isProcessing ? "border-white/10 cursor-default" : dragging ? "border-amber bg-amber/5 cursor-pointer" : "border-white/20 bg-white/5 hover:border-white/40 cursor-pointer"}
                `}
              >
                <input ref={inputRef} type="file" accept=".mp4,.mov" className="hidden" onChange={handleFileChange} />

                {phase === "loading-ffmpeg" && (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-7 h-7 border-2 border-amber border-t-transparent rounded-full animate-spin" />
                    <p className="text-white/60 text-sm">Loading compression engine…</p>
                  </div>
                )}

                {phase === "compressing" && (
                  <div className="flex flex-col items-center gap-4">
                    <p className="text-white/70 text-sm">Compressing to 720p…</p>
                    <div className="w-full max-w-xs bg-white/10 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-amber rounded-full transition-all duration-300"
                        style={{ width: `${compressionProgress}%` }}
                      />
                    </div>
                    <p className="text-amber font-mono text-sm">{compressionProgress}%</p>
                  </div>
                )}

                {phase === "idle" && !uploadError && (
                  <>
                    <p className="text-white/70">Drag and drop your match video here</p>
                    <p className="text-white/30 text-sm mt-1">or click to browse · MP4 or MOV</p>
                  </>
                )}

                {uploadError && (
                  <p className="text-red-400 text-sm">{uploadError}</p>
                )}
              </div>
            )}

            {/* Uploading banner — shown while video is visible but upload still in progress */}
            {videoUrl && phase === "uploading" && (
              <div className="flex items-center gap-3 bg-amber/10 border border-amber/20 rounded-lg px-4 py-3">
                <div className="w-4 h-4 border-2 border-amber border-t-transparent rounded-full animate-spin shrink-0" />
                <p className="text-amber text-sm">Saving to cloud… you can mark clips while this completes.</p>
              </div>
            )}

            {/* Video player */}
            {videoUrl && (
              <div className="rounded-xl overflow-hidden bg-black">
                <video ref={videoRef} src={videoUrl} controls className="w-full max-h-[420px] object-contain" />
              </div>
            )}

            {videoUrl && (
              <button onClick={resetVideo} className="text-white/30 text-xs hover:text-white/60 transition-colors">
                ← Upload a different video
              </button>
            )}

            {/* Clipping controls */}
            {videoUrl && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-5">
                <div className="flex gap-3">
                  <button
                    onClick={() => markCurrentTime("in")}
                    className="flex-1 py-2.5 rounded-lg bg-white/10 text-white font-medium text-sm hover:bg-white/20 transition-colors"
                  >
                    Mark In
                    {markIn !== null && <span className="ml-2 text-amber font-mono text-xs">{formatTime(markIn)}</span>}
                  </button>
                  <button
                    onClick={() => markCurrentTime("out")}
                    className="flex-1 py-2.5 rounded-lg bg-white/10 text-white font-medium text-sm hover:bg-white/20 transition-colors"
                  >
                    Mark Out
                    {markOut !== null && <span className="ml-2 text-amber font-mono text-xs">{formatTime(markOut)}</span>}
                  </button>
                </div>

                {markIn !== null && markOut !== null && markOut > markIn && (
                  <p className="text-white/40 text-xs text-center">
                    {formatTime(markIn)} → {formatTime(markOut)} · {dur(markIn, markOut)}
                  </p>
                )}

                <div>
                  <p className="text-white/40 text-xs mb-2">Tag</p>
                  <div className="flex gap-3">
                    {(["attack", "defence"] as Tag[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTag(t)}
                        className={`flex-1 py-2.5 rounded-lg font-semibold text-sm capitalize transition-all ${tag === t ? "bg-amber text-navy" : "bg-white/10 text-white/60 hover:bg-white/20 hover:text-white"}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-white/40 text-xs mb-2">Label <span className="text-white/20">(optional)</span></p>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Line break from lineout"
                    className="w-full bg-white/10 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-amber/50"
                  />
                </div>

                <button
                  onClick={handleSave}
                  disabled={!canSave}
                  className={`w-full py-3 rounded-lg font-semibold text-sm transition-all ${canSave ? "bg-amber text-navy hover:brightness-110 cursor-pointer" : "bg-white/10 text-white/30 cursor-not-allowed"}`}
                >
                  {saving ? "Saving Clip…" : phase === "uploading" ? "Save Clip (upload in progress…)" : "Save Clip"}
                </button>

                {saveSuccess && <p className="text-green-400 text-sm text-center">Clip saved successfully.</p>}
                {saveError && <p className="text-red-400 text-sm text-center">{saveError}</p>}
              </div>
            )}
          </div>

          {/* RIGHT PANEL */}
          <div className="w-full lg:w-80 xl:w-96 shrink-0">
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <h2 className="text-white font-semibold text-base mb-4">Saved Clips</h2>
              {loadingClips ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-amber border-t-transparent rounded-full animate-spin" />
                </div>
              ) : clips.length === 0 ? (
                <p className="text-white/30 text-sm text-center py-8">No clips saved yet.</p>
              ) : (
                <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                  {clips.map((clip) => (
                    <div key={clip.id} className="bg-white/5 border border-white/10 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${clip.tag === "attack" ? "bg-green-500/20 text-green-400" : "bg-blue-500/20 text-blue-400"}`}>
                          {clip.tag}
                        </span>
                        <span className="text-white/30 text-xs font-mono">{dur(clip.start_time, clip.end_time)}</span>
                      </div>
                      {clip.label && <p className="text-white/80 text-sm mb-1">{clip.label}</p>}
                      <p className="text-white/30 text-xs font-mono">{formatTime(clip.start_time)} → {formatTime(clip.end_time)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}
