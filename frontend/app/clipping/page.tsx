"use client";

import { useRef, useState, ChangeEvent, useEffect, useCallback } from "react";
import { useClipQueue } from "@/context/ClipQueueContext";
import { apiFetch } from "@/lib/apiFetch";

type Tag = "attack" | "defence" | "opp_attack" | "opp_defence";
type ClipMode = "self" | "opposition";
type BaseTag = "attack" | "defence";

const MAX_RETRIES = 3;

function formatTagLabel(tag: Tag): string {
  return tag.replace("opp_", "").replace(/^\w/, (c) => c.toUpperCase());
}

function tagBadgeStyle(tag: Tag): string {
  return tag === "attack" || tag === "opp_attack"
    ? "bg-green-500/20 text-green-400"
    : "bg-blue-500/20 text-blue-400";
}

interface Match {
  id: string;
  name: string;
  date: string;
  created_at: string;
}

interface Clip {
  id: string;
  match_id: string | null;
  clip_path: string;
  clip_url: string;
  start_time: number;
  end_time: number;
  tag: Tag;
  label: string | null;
  phase: string | null;
  field_zone: string | null;
  created_at: string;
  status: 'pending' | 'analysing' | 'complete' | 'failed' | null;
  error_message: string | null;
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

function formatMatchDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: Clip['status'] }) {
  if (!status || status === 'complete') return null;
  const styles: Record<string, string> = {
    pending:   'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
    analysing: 'bg-red-500/15 text-red-400 border-red-500/25',
    failed:    'bg-red-500/15 text-red-400 border-red-500/25',
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border capitalize flex items-center gap-1 ${styles[status] ?? ''}`}>
      {status === 'analysing' && (
        <span className="w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin" />
      )}
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// MatchDropdown — select an existing match or create a new one inline
// ---------------------------------------------------------------------------

interface MatchDropdownProps {
  matches: Match[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreated: (match: Match) => void;
  onDeleted: (id: string) => void;
  mode?: "match" | "opposition";
}

function MatchDropdown({ matches, selectedId, onSelect, onCreated, onDeleted, mode = "match" }: MatchDropdownProps) {
  const isOpp = mode === "opposition";
  const noun = isOpp ? "opposition" : "match";
  const Noun = isOpp ? "Opposition" : "Match";
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowForm(false);
        setFormError("");
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const selected = matches.find((m) => m.id === selectedId);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await apiFetch(`${API}/matches/${id}`, { method: "DELETE" });
      onDeleted(id);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) { setFormError(`${Noun} name is required.`); return; }
    if (!newDate) { setFormError(`${Noun} date is required.`); return; }

    setCreating(true);
    setFormError("");
    try {
      const res = await apiFetch(`${API}/matches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, date: newDate, match_type: isOpp ? "opponent" : "match" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || `Failed to create ${noun}`);
      }
      const created: Match = await res.json();
      onCreated(created);
      onSelect(created.id);
      setNewName("");
      setNewDate("");
      setShowForm(false);
      setOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : `Failed to create ${noun}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <p className="text-white/40 text-xs mb-2">{Noun}</p>

      {/* Trigger */}
      <button
        type="button"
        onClick={() => { setOpen((p) => !p); if (open) { setShowForm(false); setFormError(""); } }}
        className="w-full bg-white/10 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-left flex items-center justify-between hover:border-white/25 focus:outline-none focus:border-white/50 transition-colors"
      >
        <span className={selected ? "text-white truncate" : "text-white/30"}>
          {selected ? `${selected.name} — ${formatMatchDate(selected.date)}` : `Select ${isOpp ? "an" : "a"} ${noun}…`}
        </span>
        <svg
          className={`w-4 h-4 text-white/40 shrink-0 ml-2 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#111] border border-white/15 rounded-xl shadow-2xl z-50 overflow-hidden">

          {/* Existing matches */}
          {matches.length > 0 && (
            <div className="max-h-52 overflow-y-auto">
              {matches.map((m) => (
                <div
                  key={m.id}
                  className={`flex items-center group transition-colors hover:bg-white/10 ${
                    selectedId === m.id ? "bg-white/10" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => { onSelect(m.id); setOpen(false); setShowForm(false); }}
                    className={`flex-1 text-left px-4 py-3 text-sm flex items-center justify-between min-w-0 ${
                      selectedId === m.id ? "text-white" : "text-white/70"
                    }`}
                  >
                    <span className="truncate">{m.name}</span>
                    <span className="text-white/30 text-xs shrink-0 ml-3">{formatMatchDate(m.date)}</span>
                  </button>
                  <button
                    type="button"
                    title="Delete match"
                    disabled={deletingId === m.id}
                    onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}
                    className="opacity-0 group-hover:opacity-100 pr-3 text-white/25 hover:text-red-400 disabled:opacity-40 transition-all shrink-0"
                  >
                    {deletingId === m.id ? (
                      <div className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add new entry */}
          {!showForm ? (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className={`w-full text-left px-4 py-3 text-sm text-white/50 hover:text-white hover:bg-white/5 flex items-center gap-2 transition-colors ${
                matches.length > 0 ? "border-t border-white/10" : ""
              }`}
            >
              <span className="text-base leading-none">+</span>
              <span>Add new {noun}</span>
            </button>
          ) : (
            <div className={`p-4 space-y-3 ${matches.length > 0 ? "border-t border-white/10" : ""}`}>
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">New {Noun}</p>

              <input
                type="text"
                value={newName}
                autoFocus
                onChange={(e) => { setNewName(e.target.value); setFormError(""); }}
                placeholder={isOpp ? "Opposition name (e.g. Harlequins)" : "Match name (e.g. vs Harlequins)"}
                className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/50"
              />

              <input
                type="date"
                value={newDate}
                onChange={(e) => { setNewDate(e.target.value); setFormError(""); }}
                className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-white/50 [color-scheme:dark]"
              />

              {formError && <p className="text-red-400 text-xs">{formError}</p>}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex-1 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {creating ? "Creating…" : "Create"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setFormError(""); setNewName(""); setNewDate(""); }}
                  className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ClippingPage
// ---------------------------------------------------------------------------

export default function ClippingPage({ fixedMode }: { fixedMode?: ClipMode } = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reverseIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountsRef = useRef<Map<string, number>>(new Map());

  // ── Clip queue (global context — survives navigation) ──
  const { queue, videoFile, videoUrl, setVideoFile, changeVideoFile, addToQueue: ctxAddToQueue, cancelItem, onClipSaved } = useClipQueue();

  const [clipMode, setClipMode] = useState<ClipMode>(fixedMode ?? "self");

  const [markIn, setMarkIn] = useState<number | null>(null);
  const [markOut, setMarkOut] = useState<number | null>(null);
  const [tag, setTag] = useState<"attack" | "defence" | null>(null);
  const [phase, setPhase] = useState<string>("");
  const [fieldZone, setFieldZone] = useState<string>("");
  const [label, setLabel] = useState("");
  const [matchId, setMatchId] = useState<string | null>(null);


  const [clips, setClips] = useState<Clip[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loadingClips, setLoadingClips] = useState(true);

  // ── Saved clips filters ──
  const [clipMatchFilter, setClipMatchFilter] = useState<string>("all");
  const [clipTagFilter, setClipTagFilter] = useState<"all" | BaseTag>("all");

  // ── Inline edit state ──
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMatchId, setEditMatchId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editPhase, setEditPhase] = useState("");
  const [editFieldZone, setEditFieldZone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // ── Delete state ──
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Bulk re-analyse state ──
  const [bulkAnalysing, setBulkAnalysing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const fetchMatches = useCallback(async () => {
    try {
      const endpoint = clipMode === "opposition" ? `${API}/opponents` : `${API}/matches`;
      const res = await apiFetch(endpoint);
      const data = await res.json();
      setMatches(Array.isArray(data) ? data : []);
    } catch { /* silently fail */ }
  }, [clipMode]);

  // Track per-clip poll intervals so we never double-poll and can clean up on unmount
  const pollIntervals = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    return () => { pollIntervals.current.forEach(id => clearInterval(id)); };
  }, []);

  // Poll a single clip until it reaches a terminal state, then update it in local state
  const pollUntilDone = useCallback((clipId: string) => {
    if (pollIntervals.current.has(clipId)) return;

    const intervalId = setInterval(async () => {
      try {
        const res = await apiFetch(`${API}/clips/${clipId}`);
        if (!res.ok) return;
        const clip: Clip = await res.json();
        if (clip.status === 'complete' || clip.status === 'failed') {
          clearInterval(pollIntervals.current.get(clipId)!);
          pollIntervals.current.delete(clipId);
          setClips(prev => prev.map(c => c.id === clipId ? clip : c));
        }
      } catch { /* silently ignore */ }
    }, 3000);

    pollIntervals.current.set(clipId, intervalId);
    // Safety: stop polling after 10 minutes regardless
    setTimeout(() => {
      if (pollIntervals.current.has(clipId)) {
        clearInterval(pollIntervals.current.get(clipId)!);
        pollIntervals.current.delete(clipId);
      }
    }, 600_000);
  }, []);

  const fetchClips = useCallback(async (): Promise<Clip[]> => {
    try {
      const res = await apiFetch(`${API}/clips`);
      const data: Clip[] = await res.json();
      setClips(data);
      // Resume polling for any clips that were in-progress before this fetch
      data.forEach(clip => {
        if (clip.status === 'pending' || clip.status === 'analysing') pollUntilDone(clip.id);
      });
      return data;
    } catch { return []; }
    finally { setLoadingClips(false); }
  }, [pollUntilDone]);

  const triggerAnalysis = useCallback(async (clipId: string, clipPath: string) => {
    try {
      await apiFetch(`${API}/analyse/clip/bg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_id: clipId, clip_path: clipPath }),
      });
      pollUntilDone(clipId);
    } catch {
      // Fire-and-forget — ignore errors silently
    }
  }, [pollUntilDone]);

  const handleRetry = useCallback(async (clip: Clip) => {
    const currentCount = retryCountsRef.current.get(clip.id) ?? 0;
    if (currentCount >= MAX_RETRIES) return;
    retryCountsRef.current.set(clip.id, currentCount + 1);
    // Optimistically update status so UI reflects the retry
    setClips((prev) => prev.map((c) => c.id === clip.id ? { ...c, status: 'pending' } : c));
    await triggerAnalysis(clip.id, clip.clip_path);
  }, [triggerAnalysis]);

  useEffect(() => { fetchMatches(); fetchClips(); }, [fetchMatches, fetchClips]);

  // Reset match/opponent selection when mode changes
  useEffect(() => { setMatchId(null); setMatches([]); }, [clipMode]);

  // Keyboard shortcuts — only active when a video is loaded and focus isn't in a text input
  useEffect(() => {
    if (!videoUrl) return;

    function stopReverse() {
      if (reverseIntervalRef.current) {
        clearInterval(reverseIntervalRef.current);
        reverseIntervalRef.current = null;
        videoRef.current?.pause();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (inInput) return;

      const video = videoRef.current;
      if (!video) return;

      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setMarkIn(video.currentTime);
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setMarkOut(video.currentTime);
      } else if (e.code === "Space") {
        e.preventDefault();
        if (reverseIntervalRef.current) { stopReverse(); return; }
        video.playbackRate = 1;
        video.paused ? video.play() : video.pause();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - 5);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
      } else if (e.key === ">" || e.key === ".") {
        // 2× forward — toggle between 2x and 1x
        e.preventDefault();
        stopReverse();
        if (video.paused) {
          video.playbackRate = 2;
          video.play();
        } else {
          video.playbackRate = video.playbackRate === 2 ? 1 : 2;
        }
      } else if (e.key === "<" || e.key === ",") {
        // Hold to reverse at 2× — simulated (browsers don't support negative playbackRate)
        e.preventDefault();
        if (reverseIntervalRef.current) return; // already reversing
        video.pause();
        reverseIntervalRef.current = setInterval(() => {
          const v = videoRef.current;
          if (!v) return;
          if (v.currentTime <= 0) { stopReverse(); return; }
          v.currentTime = Math.max(0, v.currentTime - 0.1); // 0.1s every 50ms = 2× reverse
        }, 50);
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      if (e.key === "<" || e.key === ",") stopReverse();
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      stopReverse();
    };
  }, [videoUrl]);

  // When the component mounts with an existing videoUrl (returning from navigation),
  // the <video> element renders with src already set but never calls load() — force it.
  useEffect(() => {
    if (videoUrl && videoRef.current) {
      videoRef.current.load();
    }
  }, [videoUrl]);

  // Register fetchClips callback so context can notify us after each upload
  useEffect(() => {
    onClipSaved.current = () => { fetchClips(); };
    return () => { onClipSaved.current = null; };
  }, [onClipSaved, fetchClips]);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset the input value so the same file can be re-selected after a change
    e.target.value = "";
    setVideoFile(file);
    setMarkIn(null);
    setMarkOut(null);
  }

  function handleChangeVideo() {
    changeVideoFile();
    setMarkIn(null);
    setMarkOut(null);
    // Re-open file picker after state has cleared
    setTimeout(() => inputRef.current?.click(), 0);
  }

  function markCurrentTime(which: "in" | "out") {
    const t = videoRef.current?.currentTime ?? 0;
    if (which === "in") setMarkIn(t);
    else setMarkOut(t);
  }

  function addToQueue() {
    if (!videoUrl || markIn === null || markOut === null || !tag || !phase || !fieldZone) return;
    if (markOut <= markIn) return;
    const effectiveTag: Tag = clipMode === "opposition" ? `opp_${tag}` : tag;
    ctxAddToQueue({ markIn, markOut, tag: effectiveTag, label, matchId, phase, field_zone: fieldZone });
    setMarkIn(null);
    setMarkOut(null);
    setLabel("");
  }

  const canClip = !!videoUrl && markIn !== null && markOut !== null && markOut > markIn && !!tag && !!phase && !!fieldZone;

  function resolveMatchName(id: string | null): string | null {
    if (!id) return null;
    return matches.find((m) => m.id === id)?.name ?? null;
  }

  function startEdit(clip: Clip) {
    setEditingId(clip.id);
    setEditMatchId(clip.match_id);
    setEditLabel(clip.label ?? "");
    setEditPhase(clip.phase ?? "");
    setEditFieldZone(clip.field_zone ?? "");
    setSaveError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setSaveError("");
  }

  async function handleDelete(clip: Clip) {
    if (!window.confirm(`Delete this clip? This cannot be undone.`)) return;
    setDeletingId(clip.id);
    try {
      const res = await apiFetch(`${API}/clips/${clip.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || "Failed to delete");
      }
      setClips((prev) => prev.filter((c) => c.id !== clip.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete clip");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSaveEdit(clipId: string) {
    setSaving(true);
    setSaveError("");
    try {
      const res = await apiFetch(`${API}/clips/${clipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_id: editMatchId || null,
          label: editLabel.trim() || null,
          phase: editPhase || null,
          field_zone: editFieldZone || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || "Failed to save");
      }
      const updated: Clip = await res.json();
      setClips((prev) => prev.map((c) => (c.id === clipId ? updated : c)));
      setEditingId(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkReanalyse() {
    if (!window.confirm(`Re-analyse all ${clips.length} clip${clips.length !== 1 ? "s" : ""} through the updated pipeline?\n\nThis will reset and re-run every clip. It may take several minutes.`)) return;
    setBulkAnalysing(true);
    setBulkProgress({ done: 0, total: clips.length });
    let done = 0;
    for (const clip of clips) {
      try {
        // Reset status to pending in local state immediately
        setClips((prev) => prev.map((c) => c.id === clip.id ? { ...c, status: "pending" } : c));
        await apiFetch(`${API}/analyse/clip/bg`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clip_id: clip.id, clip_path: clip.clip_path }),
        });
        pollUntilDone(clip.id);
      } catch { /* best-effort — continue to next clip */ }
      done++;
      setBulkProgress({ done, total: clips.length });
      // Small gap between requests to avoid overwhelming the server
      await new Promise((r) => setTimeout(r, 300));
    }
    setBulkAnalysing(false);
    setBulkProgress(null);
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-bold text-white">Clipping Tool</h1>
            {fixedMode === "opposition" && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30">
                Opposition
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-col gap-1.5">
            {[
              { n: "1", text: "Upload the full match mp4/mov file using the panel on the left." },
              { n: "2", text: "Clip significant attack or defence sequences you would like analysed." },
              { n: "3", text: "Use the video player to find the start of a sequence, then press Mark In." },
              { n: "4", text: "Find the end of the sequence and press Mark Out." },
              { n: "5", text: "Choose a label, select Attack or Defence, then press Save Clip." },
              { n: "6", text: "Repeat for every sequence you want analysed. The AI will analyse each clip automatically in the background." },
            ].map(({ n, text }) => (
              <div key={n} className="flex gap-3 items-start">
                <span className="text-white/25 text-xs font-bold w-4 shrink-0 mt-0.5">{n}</span>
                <p className="text-white/50 text-sm">{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Mode toggle — only shown when no fixed mode is set ── */}
        {!fixedMode && (
          <>
            <div className="mb-5 flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1 max-w-xs">
              {(["self", "opposition"] as ClipMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setClipMode(mode)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-all ${
                    clipMode === mode
                      ? mode === "opposition"
                        ? "bg-orange-500/20 text-orange-300 border border-orange-500/30"
                        : "bg-white/15 text-white"
                      : "text-white/40 hover:text-white/70"
                  }`}
                >
                  {mode === "self" ? "My Team" : "Opposition"}
                </button>
              ))}
            </div>

            {clipMode === "opposition" && (
              <div className="mb-5 rounded-xl bg-orange-500/10 border border-orange-500/20 px-4 py-3 max-w-sm">
                <p className="text-orange-300 text-xs font-semibold">Opposition mode</p>
                <p className="text-orange-300/70 text-xs mt-0.5">Clips will be analysed from the opposition's perspective for scouting reports.</p>
              </div>
            )}
          </>
        )}

        {/* ── Match selector — always visible ── */}
        <div className="mb-6 max-w-sm">
          <MatchDropdown
            matches={matches}
            selectedId={matchId}
            onSelect={setMatchId}
            onCreated={(m) => setMatches((prev) => [m, ...prev])}
            onDeleted={(id) => {
              setMatches((prev) => prev.filter((m) => m.id !== id));
              if (matchId === id) setMatchId(null);
            }}
            mode={clipMode === "opposition" ? "opposition" : "match"}
          />
        </div>

        <div className="flex flex-col lg:flex-row gap-6">

          {/* ── LEFT PANEL ── */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* File picker */}
            <input ref={inputRef} type="file" accept=".mp4,.mov" className="hidden" onChange={handleFileChange} />

            {!videoUrl ? (
              <div
                onClick={() => inputRef.current?.click()}
                className="rounded-xl border-2 border-dashed border-white/20 bg-white/5 hover:border-white/40 cursor-pointer px-6 py-16 text-center transition-colors"
              >
                <p className="text-white/70">Click to select a video file</p>
                <p className="text-white/30 text-sm mt-1">MP4 or MOV · stays in your browser, never uploaded</p>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-white/50 text-xs truncate max-w-[70%]">
                  {videoFile?.name ?? "Video loaded"}
                </span>
                <button
                  onClick={handleChangeVideo}
                  className="text-white/30 text-xs hover:text-white/70 transition-colors shrink-0 ml-3 underline underline-offset-2"
                >
                  Change video
                </button>
              </div>
            )}

            {/* Video player */}
            {videoUrl && (
              <div className="rounded-xl overflow-hidden bg-black">
                <video ref={videoRef} src={videoUrl} controls className="w-full max-h-[420px] object-contain" />
              </div>
            )}

            {/* Clipping controls */}
            {videoUrl && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-5">

                {/* Mark In / Out */}
                <div className="flex gap-3">
                  <button
                    onClick={() => markCurrentTime("in")}
                    className="flex-1 py-2.5 rounded-lg bg-white/10 text-white font-medium text-sm hover:bg-white/20 transition-colors"
                  >
                    Mark In
                    {markIn !== null && (
                      <span className="ml-2 text-white font-mono text-xs">{formatTime(markIn)}</span>
                    )}
                  </button>
                  <button
                    onClick={() => markCurrentTime("out")}
                    className="flex-1 py-2.5 rounded-lg bg-white/10 text-white font-medium text-sm hover:bg-white/20 transition-colors"
                  >
                    Mark Out
                    {markOut !== null && (
                      <span className="ml-2 text-white font-mono text-xs">{formatTime(markOut)}</span>
                    )}
                  </button>
                </div>

                {/* Manual time inputs */}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <p className="text-white/40 text-xs mb-1">In (seconds)</p>
                    <input
                      type="number" min="0" step="0.1"
                      value={markIn ?? ""}
                      onChange={(e) => setMarkIn(e.target.value === "" ? null : Number(e.target.value))}
                      placeholder="0.0"
                      className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-white/50 font-mono"
                    />
                  </div>
                  <div className="flex-1">
                    <p className="text-white/40 text-xs mb-1">Out (seconds)</p>
                    <input
                      type="number" min="0" step="0.1"
                      value={markOut ?? ""}
                      onChange={(e) => setMarkOut(e.target.value === "" ? null : Number(e.target.value))}
                      placeholder="0.0"
                      className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-white/50 font-mono"
                    />
                  </div>
                </div>

                {markIn !== null && markOut !== null && markOut > markIn && (
                  <p className="text-white/40 text-xs text-center">
                    {formatTime(markIn)} → {formatTime(markOut)} · {dur(markIn, markOut)}
                  </p>
                )}

                {/* Tag */}
                <div>
                  <p className="text-white/40 text-xs mb-2">Tag</p>
                  <div className="flex gap-3">
                    {(["attack", "defence"] as ("attack" | "defence")[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTag(t)}
                        className={`flex-1 py-2.5 rounded-lg font-semibold text-sm capitalize transition-all ${
                          tag === t
                            ? "bg-white text-black"
                            : "bg-white/10 text-white/60 hover:bg-white/20 hover:text-white"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Phase */}
                <div>
                  <p className="text-white/40 text-xs mb-2">Phase <span className="text-red-400">*</span></p>
                  <select
                    value={phase}
                    onChange={(e) => setPhase(e.target.value)}
                    className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-white/50 appearance-none text-white [&>option]:bg-[#111] [&>option]:text-white"
                  >
                    <option value="" disabled>Select phase…</option>
                    <option value="Set Piece — Scrum">Set Piece — Scrum</option>
                    <option value="Set Piece — Lineout">Set Piece — Lineout</option>
                    <option value="Phase Play / Breakdown">Phase Play / Breakdown</option>
                    <option value="Transition">Transition</option>
                    <option value="Kick Receipt / Counter Attack">Kick Receipt / Counter Attack</option>
                  </select>
                </div>

                {/* Field Zone */}
                <div>
                  <p className="text-white/40 text-xs mb-2">Field Zone <span className="text-red-400">*</span></p>
                  <select
                    value={fieldZone}
                    onChange={(e) => setFieldZone(e.target.value)}
                    className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-white/50 appearance-none text-white [&>option]:bg-[#111] [&>option]:text-white"
                  >
                    <option value="" disabled>Select field zone…</option>
                    <option value="Own 22">Own 22</option>
                    <option value="Own Half (22m–halfway)">Own Half (22m–halfway)</option>
                    <option value="Opposition Half (halfway–22m)">Opposition Half (halfway–22m)</option>
                    <option value="Opposition 22">Opposition 22</option>
                  </select>
                </div>

                {/* Label */}
                <div>
                  <p className="text-white/40 text-xs mb-2">
                    Label <span className="text-white/20">(optional)</span>
                  </p>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Line break from lineout"
                    className="w-full bg-white/10 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-white/50"
                  />
                </div>

                {/* Add to Queue */}
                <button
                  onClick={addToQueue}
                  disabled={!canClip}
                  className={`w-full py-3 rounded-lg font-semibold text-sm transition-all ${
                    canClip
                      ? "bg-white text-black hover:brightness-110 cursor-pointer"
                      : "bg-white/10 text-white/30 cursor-not-allowed"
                  }`}
                >
                  Add to Queue
                </button>

                {/* Queue */}
                {queue.length > 0 && (
                  <div className="space-y-2">
                    {queue.map((item) => (
                      <div key={item.queueId} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-white/70 text-xs truncate">
                            {item.tag} · {formatTime(item.markIn)} → {formatTime(item.markOut)}
                            {item.label && ` · ${item.label}`}
                          </p>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          {item.status === 'recording' && (
                            <>
                              <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                              <span className="text-blue-400 text-xs">{item.progress}%</span>
                            </>
                          )}
                          {item.status === 'uploading' && (
                            <>
                              <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                              <span className="text-blue-400 text-xs">Uploading…</span>
                            </>
                          )}
                          {item.status === 'queued' && (
                            <span className="text-white/40 text-xs">Queued</span>
                          )}
                          {item.status === 'done' && (
                            <span className="text-green-400 text-xs">Done</span>
                          )}
                          {item.status === 'failed' && (
                            <span className="text-red-400 text-xs" title={item.error}>Failed</span>
                          )}
                          {(item.status === 'queued' || item.status === 'recording' || item.status === 'uploading') && (
                            <button
                              onClick={() => cancelItem(item.queueId)}
                              title="Cancel"
                              className="text-white/25 hover:text-red-400 transition-colors p-0.5 rounded ml-1"
                            >
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── RIGHT PANEL — hotkeys + saved clips ── */}
          <div className="w-full lg:w-80 xl:w-96 shrink-0 space-y-4">

            {/* Hot Keys card */}
            <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
              <h2 className="text-white/70 font-semibold text-xs uppercase tracking-wider mb-2">Hot Keys</h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {[
                  ["Space", "Play / Pause"],
                  ["S", "Mark start"],
                  ["←", "Back 5s"],
                  ["E", "Mark end"],
                  ["→", "Forward 5s"],
                  ["<", "2× reverse"],
                  [">", "2× forward"],
                ].map(([key, desc]) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <kbd className="inline-flex items-center justify-center min-w-[1.6rem] px-1.5 py-px rounded bg-white/10 border border-white/15 text-white/80 font-mono text-[10px] leading-4 shrink-0">
                      {key}
                    </kbd>
                    <span className="text-white/40 text-[10px] truncate">{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-semibold text-base">Saved Clips</h2>
                {clips.length > 0 && (
                  <button
                    onClick={handleBulkReanalyse}
                    disabled={bulkAnalysing}
                    title="Re-analyse all clips through the updated pipeline"
                    className="text-xs text-white/40 hover:text-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {bulkAnalysing && bulkProgress
                      ? `Re-analysing… ${bulkProgress.done}/${bulkProgress.total}`
                      : "Re-analyse all"}
                  </button>
                )}
              </div>

              {/* Filters */}
              <div className="flex flex-col gap-2 mb-4">
                {/* Match / Opposition filter */}
                <select
                  value={clipMatchFilter}
                  onChange={(e) => setClipMatchFilter(e.target.value)}
                  className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-white/30 appearance-none"
                >
                  <option value="all">{clipMode === "opposition" ? "All Oppositions" : "All Matches"}</option>
                  <option value="none">{clipMode === "opposition" ? "No Opposition Assigned" : "No Match Assigned"}</option>
                  {matches.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                {/* Tag filter */}
                <div className="flex gap-1.5">
                  {(["all", "attack", "defence"] as ("all" | BaseTag)[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setClipTagFilter(t)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                        clipTagFilter === t
                          ? "bg-amber text-navy"
                          : "bg-white/10 text-white/40 hover:text-white hover:bg-white/20"
                      }`}
                    >
                      {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {(() => {
                // Mode-aware clip filtering
                const effectiveTagFilter = (t: "all" | BaseTag): "all" | Tag =>
                  t === "all" ? "all" : clipMode === "opposition" ? `opp_${t}` : t;
                const modeTagFilter = effectiveTagFilter(clipTagFilter);

                const visibleClips = clips.filter((c) => {
                  // Filter by current mode: only show clips that belong to this mode
                  const isOppositionClip = c.tag === "opp_attack" || c.tag === "opp_defence";
                  if (clipMode === "opposition" && !isOppositionClip) return false;
                  if (clipMode === "self" && isOppositionClip) return false;
                  // Match filter
                  if (clipMatchFilter !== "all" && (clipMatchFilter === "none" ? !!c.match_id : c.match_id !== clipMatchFilter)) return false;
                  // Tag filter
                  if (modeTagFilter !== "all" && c.tag !== modeTagFilter) return false;
                  return true;
                });

                return loadingClips ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              ) : visibleClips.length === 0 ? (
                <p className="text-white/30 text-sm text-center py-8">No clips match the selected filters.</p>
              ) : (
                <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                  {visibleClips.map((clip) =>
                    editingId === clip.id ? (
                      /* ── Edit form ── */
                      <div key={clip.id} className="bg-white/8 border border-white/25 rounded-lg p-4 space-y-3">

                        {/* Mini header */}
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tagBadgeStyle(clip.tag)}`}>
                            {formatTagLabel(clip.tag)}
                          </span>
                          <span className="text-white/30 text-xs font-mono">
                            {formatTime(clip.start_time)} → {formatTime(clip.end_time)}
                          </span>
                        </div>

                        {/* Match selector */}
                        <MatchDropdown
                          matches={matches}
                          selectedId={editMatchId}
                          onSelect={setEditMatchId}
                          onCreated={(m) => {
                            setMatches((prev) => [m, ...prev]);
                            setEditMatchId(m.id);
                          }}
                          onDeleted={(id) => {
                            setMatches((prev) => prev.filter((m) => m.id !== id));
                            if (editMatchId === id) setEditMatchId(null);
                          }}
                        />

                        {/* Phase */}
                        <div>
                          <p className="text-white/40 text-xs mb-1">Phase</p>
                          <select
                            value={editPhase}
                            onChange={(e) => setEditPhase(e.target.value)}
                            className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/50 appearance-none [&>option]:bg-[#111] [&>option]:text-white"
                          >
                            <option value="">Not set</option>
                            <option value="Set Piece — Scrum">Set Piece — Scrum</option>
                            <option value="Set Piece — Lineout">Set Piece — Lineout</option>
                            <option value="Phase Play / Breakdown">Phase Play / Breakdown</option>
                            <option value="Transition">Transition</option>
                            <option value="Kick Receipt / Counter Attack">Kick Receipt / Counter Attack</option>
                          </select>
                        </div>

                        {/* Field Zone */}
                        <div>
                          <p className="text-white/40 text-xs mb-1">Field Zone</p>
                          <select
                            value={editFieldZone}
                            onChange={(e) => setEditFieldZone(e.target.value)}
                            className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/50 appearance-none [&>option]:bg-[#111] [&>option]:text-white"
                          >
                            <option value="">Not set</option>
                            <option value="Own 22">Own 22</option>
                            <option value="Own Half (22m–halfway)">Own Half (22m–halfway)</option>
                            <option value="Opposition Half (halfway–22m)">Opposition Half (halfway–22m)</option>
                            <option value="Opposition 22">Opposition 22</option>
                          </select>
                        </div>

                        {/* Label / context */}
                        <div>
                          <p className="text-white/40 text-xs mb-1">
                            Label <span className="text-white/20">(optional)</span>
                          </p>
                          <input
                            type="text"
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            placeholder="e.g. Line break from lineout"
                            className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-white/50"
                          />
                        </div>

                        {saveError && <p className="text-red-400 text-xs">{saveError}</p>}

                        {/* Save / Cancel */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSaveEdit(clip.id)}
                            disabled={saving}
                            className="flex-1 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20 transition-all"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* ── Normal view ── */
                      <div key={clip.id} className="bg-white/5 border border-white/10 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tagBadgeStyle(clip.tag)}`}>
                              {formatTagLabel(clip.tag)}
                            </span>
                            <StatusBadge status={clip.status} />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-white/30 text-xs font-mono">
                              {dur(clip.start_time, clip.end_time)}
                            </span>
                            {/* Edit button */}
                            <button
                              onClick={() => startEdit(clip)}
                              title="Edit clip details"
                              className="text-white/25 hover:text-white/70 transition-colors p-0.5 rounded"
                            >
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                            {/* Delete button */}
                            <button
                              onClick={() => handleDelete(clip)}
                              disabled={deletingId === clip.id}
                              title="Delete clip"
                              className="text-white/25 hover:text-red-400 transition-colors p-0.5 rounded disabled:opacity-40"
                            >
                              {deletingId === clip.id ? (
                                <div className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                  <path d="M10 11v6M14 11v6" />
                                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </div>

                        {clip.label && (
                          <p className="text-white/80 text-sm mb-1">{clip.label}</p>
                        )}

                        {clip.match_id && resolveMatchName(clip.match_id) ? (
                          <p className="text-white/40 text-xs mb-1">{resolveMatchName(clip.match_id)}</p>
                        ) : (
                          <p className="text-white/20 text-xs mb-1 italic">No match assigned</p>
                        )}

                        {(clip.phase || clip.field_zone) && (
                          <p className="text-white/35 text-xs mb-1">
                            {[clip.phase, clip.field_zone].filter(Boolean).join(" · ")}
                          </p>
                        )}

                        <p className="text-white/25 text-xs font-mono">
                          {formatTime(clip.start_time)} → {formatTime(clip.end_time)}
                        </p>

                        {clip.status === 'failed' && (() => {
                          const retries = retryCountsRef.current.get(clip.id) ?? 0;
                          return retries >= MAX_RETRIES ? (
                            <div className="mt-2 space-y-0.5">
                              <p className="text-red-400 text-xs font-semibold">Failed analysis</p>
                              {clip.error_message && (
                                <p className="text-red-400/60 text-xs leading-snug">{clip.error_message}</p>
                              )}
                            </div>
                          ) : (
                            <div className="mt-2 flex items-center gap-3">
                              <button
                                onClick={() => handleRetry(clip)}
                                className="text-xs text-red-400 hover:text-red-300 underline transition-colors"
                              >
                                Retry analysis
                              </button>
                              <span className="text-white/20 text-xs">{MAX_RETRIES - retries} attempt{MAX_RETRIES - retries !== 1 ? "s" : ""} remaining</span>
                            </div>
                          );
                        })()}

                        {clip.status === 'complete' && (
                          <p className="text-green-400/70 text-xs mt-1.5">Analysis complete</p>
                        )}
                      </div>
                    )
                  )}
                </div>
              );
              })()}
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}
