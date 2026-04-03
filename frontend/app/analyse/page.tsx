"use client";

import { useRef, useState, DragEvent, ChangeEvent } from "react";

type AnalysisType = "attack" | "defence";

const API = process.env.NEXT_PUBLIC_API_URL;

async function* readSSE(res: Response): AsyncGenerator<{ chunk?: string; status?: string; error?: string }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try { yield JSON.parse(line.slice(6)); } catch { /* skip malformed */ }
      }
    }
  }
}

export default function AnalysePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const analysisRef = useRef<HTMLPreElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [analysisType, setAnalysisType] = useState<AnalysisType | null>(null);

  const [waiting, setWaiting] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  function handleDragOver(e: DragEvent<HTMLDivElement>) { e.preventDefault(); setDragging(true); }
  function handleDragLeave() { setDragging(false); }
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.name.endsWith(".mp4")) setFile(dropped);
  }
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  }

  async function handleSubmit() {
    if (!file || !analysisType) return;

    setWaiting(true);
    setStreaming(false);
    setAnalysis("");
    setErrorMsg("");
    setStatusMsg("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API}/analyse/${analysisType}`, { method: "POST", body: formData });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server error: ${res.status}`);
      }

      for await (const event of readSSE(res)) {
        if (event.error) throw new Error(event.error);
        if (event.status) setStatusMsg(event.status);
        if (event.chunk) {
          setWaiting(false);
          setStreaming(true);
          setAnalysis((prev) => prev + event.chunk);
          analysisRef.current?.parentElement?.scrollTo({ top: analysisRef.current.scrollHeight, behavior: "smooth" });
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setWaiting(false);
      setStreaming(false);
      setStatusMsg("");
    }
  }

  const isRunning = waiting || streaming;
  const canSubmit = file !== null && analysisType !== null && !isRunning;

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white">Analyse a Clip</h1>
        </div>

        {/* Upload area */}
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${dragging ? "border-amber bg-amber/5" : file ? "border-amber/60 bg-white/5" : "border-white/20 bg-white/5 hover:border-white/40"}`}
        >
          <input ref={inputRef} type="file" accept=".mp4" className="hidden" onChange={handleFileChange} />
          {file ? (
            <div>
              <p className="text-amber font-medium text-lg">{file.name}</p>
              <p className="text-white/40 text-sm mt-1">{(file.size / (1024 * 1024)).toFixed(1)} MB · Click to change</p>
            </div>
          ) : (
            <div>
              <p className="text-white/70 text-base">Drag and drop your clip here</p>
              <p className="text-white/30 text-sm mt-1">or click to browse · MP4 only</p>
            </div>
          )}
        </div>

        {/* Analysis type */}
        <div className="mt-6">
          <p className="text-white/50 text-sm mb-3">Analysis type</p>
          <div className="flex gap-3">
            {(["attack", "defence"] as AnalysisType[]).map((type) => (
              <button
                key={type}
                onClick={() => setAnalysisType(type)}
                className={`flex-1 py-3 rounded-lg font-semibold text-sm capitalize transition-all ${analysisType === type ? "bg-amber text-navy" : "bg-white/10 text-white/60 hover:bg-white/20 hover:text-white"}`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`mt-6 w-full py-3 rounded-lg font-semibold text-base transition-all ${canSubmit ? "bg-amber text-navy hover:brightness-110 cursor-pointer" : "bg-white/10 text-white/30 cursor-not-allowed"}`}
        >
          {isRunning ? "Analysing…" : "Analyse"}
        </button>

        {/* Spinner + status before first chunk */}
        {waiting && (
          <div className="mt-10 flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-2 border-amber border-t-transparent rounded-full animate-spin" />
            <p className="text-white/60 text-sm">{statusMsg || "Connecting…"}</p>
          </div>
        )}

        {errorMsg && (
          <div className="mt-8 rounded-lg bg-red-500/10 border border-red-500/30 px-5 py-4">
            <p className="text-red-400 text-sm">{errorMsg}</p>
          </div>
        )}

        {/* Streaming output */}
        {analysis && (
          <div className="mt-10">
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-block w-6 h-0.5 bg-amber" />
              <h2 className="text-white font-semibold text-lg capitalize">{analysisType} Analysis</h2>
              {streaming && <div className="w-3 h-3 border border-amber border-t-transparent rounded-full animate-spin" />}
            </div>
            <div className="bg-white/5 rounded-xl px-6 py-6 border border-white/10 max-h-[60vh] overflow-y-auto">
              <pre ref={analysisRef} className="text-white/85 text-sm leading-7 whitespace-pre-wrap font-sans">
                {analysis}
              </pre>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
