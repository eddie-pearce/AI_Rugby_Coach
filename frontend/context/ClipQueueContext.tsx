"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  ReactNode,
} from "react";
import { apiFetch } from "@/lib/apiFetch";

// ── Types ──────────────────────────────────────────────────────────────────────

type Tag = "attack" | "defence" | "opp_attack" | "opp_defence";

export interface QueueItem {
  queueId: string;
  markIn: number;
  markOut: number;
  tag: Tag;
  label: string;
  matchId: string | null;
  phase: string;
  field_zone: string;
  /** Blob URL — kept alive for the lifetime of the queue item */
  videoUrl: string;
  status: "queued" | "recording" | "uploading" | "done" | "failed";
  progress: number;
  error?: string;
}

export interface ClipQueueContextValue {
  queue: QueueItem[];
  videoFile: File | null;
  videoUrl: string | null;
  setVideoFile: (file: File) => void;
  changeVideoFile: () => void; // clears file+url so page can prompt a new pick
  addToQueue: (
    item: Omit<QueueItem, "queueId" | "status" | "progress" | "videoUrl">
  ) => void;
  cancelItem: (queueId: string) => void;
  /** Called by the clipping page after upload so it can refresh its clips list */
  onClipSaved: React.MutableRefObject<(() => void) | null>;
}

// ── Context ────────────────────────────────────────────────────────────────────

const ClipQueueContext = createContext<ClipQueueContextValue | null>(null);

export function useClipQueue() {
  const ctx = useContext(ClipQueueContext);
  if (!ctx) throw new Error("useClipQueue must be used within ClipQueueProvider");
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────────────────────

const API = process.env.NEXT_PUBLIC_API_URL;

export function ClipQueueProvider({ children }: { children: ReactNode }) {
  const CONCURRENCY = 3;

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const activeCountRef = useRef(0);

  // Video file + url
  const [videoFile, setVideoFileState] = useState<File | null>(null);
  const [videoUrl, setVideoUrlState] = useState<string | null>(null);
  // Track all live blob URLs so we can revoke them once no queue items need them
  const blobUrlsRef = useRef<Set<string>>(new Set());

  // Callback ref: clipping page registers its fetchClips so we can call it after upload
  const onClipSaved = useRef<(() => void) | null>(null);

  // Per-item cancel functions registered during processNext
  const cancelFnsRef = useRef<Map<string, () => void>>(new Map());

  // ── Queue helpers ──

  function updateQueue(updater: (prev: QueueItem[]) => QueueItem[]) {
    const next = updater(queueRef.current);
    queueRef.current = next;
    setQueue(next);
  }

  function tryRevoke(url: string) {
    // Only revoke if no active queue item still needs it
    const inUse = queueRef.current.some(
      (i) =>
        i.videoUrl === url &&
        i.status !== "done" &&
        i.status !== "failed"
    );
    if (!inUse && url !== videoUrl) {
      URL.revokeObjectURL(url);
      blobUrlsRef.current.delete(url);
    }
  }

  // ── Video file management ──

  function setVideoFile(file: File) {
    const url = URL.createObjectURL(file);
    blobUrlsRef.current.add(url);
    setVideoFileState(file);
    setVideoUrlState(url);
  }

  function changeVideoFile() {
    // Clear the active video so the page shows the file picker again.
    // Do NOT revoke the blob URL yet — queued items may still reference it.
    setVideoFileState(null);
    setVideoUrlState(null);
  }

  // ── Queue processor ──

  const tryStartNextRef = useRef<() => void>(() => {});

  const processItem = useCallback(async (item: QueueItem) => {
    activeCountRef.current++;

    const updateItem = (patch: Partial<QueueItem>) => {
      updateQueue((prev) =>
        prev.map((i) => (i.queueId === item.queueId ? { ...i, ...patch } : i))
      );
    };

    updateItem({ status: "recording" });

    let cancelled = false;

    try {
      // Record at 1× speed using a hidden video element so Gemini gets correct timing
      const clipBlob = await new Promise<Blob>((resolve, reject) => {
        const hidden = document.createElement("video");
        hidden.src = item.videoUrl;
        hidden.muted = true;
        hidden.style.display = "none";
        document.body.appendChild(hidden);

        const cleanup = () => {
          hidden.pause();
          if (document.body.contains(hidden)) {
            document.body.removeChild(hidden);
          }
        };

        // Register cancel fn for this recording phase
        cancelFnsRef.current.set(item.queueId, () => {
          cancelled = true;
          cleanup();
          reject(new Error("cancelled"));
        });

        hidden.addEventListener(
          "error",
          () => { cleanup(); reject(new Error("Video failed to load")); },
          { once: true }
        );

        hidden.addEventListener(
          "canplay",
          () => { hidden.currentTime = item.markIn; },
          { once: true }
        );

        hidden.addEventListener(
          "seeked",
          () => {
            const stream = (
              hidden as HTMLVideoElement & { captureStream: () => MediaStream }
            ).captureStream();

            const mimeType = MediaRecorder.isTypeSupported(
              "video/webm;codecs=vp9,opus"
            )
              ? "video/webm;codecs=vp9,opus"
              : "video/webm";

            const recorder = new MediaRecorder(stream, { mimeType });
            const chunks: BlobPart[] = [];
            const duration = item.markOut - item.markIn;

            // Update cancel fn now that we have the recorder reference
            cancelFnsRef.current.set(item.queueId, () => {
              cancelled = true;
              if (recorder.state !== "inactive") recorder.stop();
              cleanup();
            });

            recorder.ondataavailable = (e) => {
              if (e.data.size > 0) chunks.push(e.data);
            };
            recorder.onstop = () => {
              cleanup();
              if (cancelled) {
                reject(new Error("cancelled"));
              } else {
                resolve(new Blob(chunks, { type: "video/webm" }));
              }
            };
            recorder.onerror = () => {
              cleanup();
              reject(new Error("Recording failed"));
            };

            hidden.playbackRate = 1;
            recorder.start(100);
            hidden.play().catch((e) => { cleanup(); reject(e); });

            const checkEnd = () => {
              if (cancelled) return;
              if (hidden.currentTime >= item.markOut) {
                recorder.stop();
              } else {
                const elapsed = hidden.currentTime - item.markIn;
                updateItem({
                  progress: Math.min(99, Math.round((elapsed / duration) * 100)),
                });
                requestAnimationFrame(checkEnd);
              }
            };
            requestAnimationFrame(checkEnd);
          },
          { once: true }
        );

        hidden.load();
      });

      cancelFnsRef.current.delete(item.queueId);

      if (cancelled) throw new Error("cancelled");

      updateItem({ status: "uploading", progress: 100 });

      // Register cancel fn for upload phase via AbortController
      const abortController = new AbortController();
      cancelFnsRef.current.set(item.queueId, () => {
        cancelled = true;
        abortController.abort();
      });

      const formData = new FormData();
      formData.append(
        "file",
        new File([clipBlob], "clip.webm", { type: "video/webm" })
      );
      formData.append("start_time", String(item.markIn));
      formData.append("end_time", String(item.markOut));
      formData.append("tag", item.tag);
      formData.append("label", item.label);
      if (item.matchId) formData.append("match_id", item.matchId);
      if (item.phase) formData.append("phase", item.phase);
      if (item.field_zone) formData.append("field_zone", item.field_zone);

      const res = await apiFetch(`${API}/clips/upload-direct`, {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });

      cancelFnsRef.current.delete(item.queueId);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { detail?: string }).detail || "Upload failed"
        );
      }

      const savedClip = await res.json() as { id: string; clip_path: string };
      updateItem({ status: "done" });

      // Notify clipping page to refresh its clips list
      onClipSaved.current?.();

      // Trigger background analysis (fire-and-forget)
      apiFetch(`${API}/analyse/clip/bg`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip_id: savedClip.id,
          clip_path: savedClip.clip_path,
        }),
      }).catch(() => {});

      // Remove done item after 3 s and revoke blob URL if no longer needed
      setTimeout(() => {
        updateQueue((prev) =>
          prev.filter((i) => i.queueId !== item.queueId)
        );
        tryRevoke(item.videoUrl);
      }, 3000);
    } catch (err) {
      cancelFnsRef.current.delete(item.queueId);
      const isCancelled = cancelled || (err instanceof Error && (err.message === "cancelled" || err.name === "AbortError"));
      if (isCancelled) {
        // Remove cancelled item immediately
        updateQueue((prev) => prev.filter((i) => i.queueId !== item.queueId));
      } else {
        updateItem({
          status: "failed",
          error: err instanceof Error ? err.message : "Failed",
        });
      }
      tryRevoke(item.videoUrl);
    }

    activeCountRef.current--;
    tryStartNextRef.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tryStartNext = useCallback(() => {
    while (activeCountRef.current < CONCURRENCY) {
      const next = queueRef.current.find((i) => i.status === "queued");
      if (!next) break;
      processItem(next);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processItem]);

  tryStartNextRef.current = tryStartNext;

  // ── cancelItem ──

  function cancelItem(queueId: string) {
    const item = queueRef.current.find((i) => i.queueId === queueId);
    if (!item) return;

    if (item.status === "queued") {
      // Not yet processing — just remove it
      updateQueue((prev) => prev.filter((i) => i.queueId !== queueId));
      tryRevoke(item.videoUrl);
      return;
    }

    // Recording or uploading — call the registered cancel fn
    const cancel = cancelFnsRef.current.get(queueId);
    if (cancel) cancel();
  }

  // ── addToQueue ──

  function addToQueue(
    itemData: Omit<QueueItem, "queueId" | "status" | "progress" | "videoUrl">
  ) {
    if (!videoUrl) return;

    const item: QueueItem = {
      ...itemData,
      queueId: Math.random().toString(36).slice(2),
      videoUrl,
      status: "queued",
      progress: 0,
    };

    updateQueue((prev) => [...prev, item]);
    tryStartNext();
  }

  return (
    <ClipQueueContext.Provider
      value={{
        queue,
        videoFile,
        videoUrl,
        setVideoFile,
        changeVideoFile,
        addToQueue,
        cancelItem,
        onClipSaved,
      }}
    >
      {children}
    </ClipQueueContext.Provider>
  );
}
