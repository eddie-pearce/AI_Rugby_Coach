"use client";

import { useRef, useState, DragEvent, ChangeEvent } from "react";
import Link from "next/link";

type AnalysisType = "attack" | "defence";

type Status = "idle" | "loading" | "success" | "error";

export default function AnalysePage() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [analysisType, setAnalysisType] = useState<AnalysisType | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [analysis, setAnalysis] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave() {
    setDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.name.endsWith(".mp4")) {
      setFile(dropped);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  }

  async function handleSubmit() {
    if (!file || !analysisType) return;

    setStatus("loading");
    setAnalysis("");
    setErrorMsg("");

    const formData = new FormData();
    formData.append("file", file);

    const apiUrl = process.env.NEXT_PUBLIC_API_URL;

    try {
      const res = await fetch(`${apiUrl}/analyse/${analysisType}`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server error: ${res.status}`);
      }

      const data = await res.json();
      setAnalysis(data.analysis);
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  const canSubmit = file !== null && analysisType !== null && status !== "loading";

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="mb-10">
          <Link href="/" className="text-white/40 text-sm hover:text-white/70 transition-colors mb-6 inline-block">
            ← Back
          </Link>
          <h1 className="text-3xl font-bold text-white">Analyse a Clip</h1>
        </div>

        {/* Upload area */}
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            cursor-pointer rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors
            ${dragging
              ? "border-amber bg-amber/5"
              : file
              ? "border-amber/60 bg-white/5"
              : "border-white/20 bg-white/5 hover:border-white/40"
            }
          `}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".mp4"
            className="hidden"
            onChange={handleFileChange}
          />
          {file ? (
            <div>
              <p className="text-amber font-medium text-lg">{file.name}</p>
              <p className="text-white/40 text-sm mt-1">
                {(file.size / (1024 * 1024)).toFixed(1)} MB · Click to change
              </p>
            </div>
          ) : (
            <div>
              <p className="text-white/70 text-base">
                Drag and drop your clip here
              </p>
              <p className="text-white/30 text-sm mt-1">or click to browse · MP4 only</p>
            </div>
          )}
        </div>

        {/* Analysis type selection */}
        <div className="mt-6">
          <p className="text-white/50 text-sm mb-3">Analysis type</p>
          <div className="flex gap-3">
            {(["attack", "defence"] as AnalysisType[]).map((type) => (
              <button
                key={type}
                onClick={() => setAnalysisType(type)}
                className={`
                  flex-1 py-3 rounded-lg font-semibold text-sm capitalize transition-all
                  ${analysisType === type
                    ? "bg-amber text-navy"
                    : "bg-white/10 text-white/60 hover:bg-white/20 hover:text-white"
                  }
                `}
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
          className={`
            mt-6 w-full py-3 rounded-lg font-semibold text-base transition-all
            ${canSubmit
              ? "bg-amber text-navy hover:brightness-110 cursor-pointer"
              : "bg-white/10 text-white/30 cursor-not-allowed"
            }
          `}
        >
          {status === "loading" ? "Analysing…" : "Analyse"}
        </button>

        {/* Loading state */}
        {status === "loading" && (
          <div className="mt-10 flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-2 border-amber border-t-transparent rounded-full animate-spin" />
            <p className="text-white/60 text-sm">Analysing clip…</p>
          </div>
        )}

        {/* Error state */}
        {status === "error" && (
          <div className="mt-8 rounded-lg bg-red-500/10 border border-red-500/30 px-5 py-4">
            <p className="text-red-400 text-sm">{errorMsg}</p>
          </div>
        )}

        {/* Results */}
        {status === "success" && analysis && (
          <div className="mt-10">
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-block w-6 h-0.5 bg-amber" />
              <h2 className="text-white font-semibold text-lg capitalize">
                {analysisType} Analysis
              </h2>
            </div>
            <div className="bg-white/5 rounded-xl px-6 py-6 border border-white/10">
              <pre className="text-white/85 text-sm leading-7 whitespace-pre-wrap font-sans">
                {analysis}
              </pre>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
