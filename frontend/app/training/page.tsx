"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/apiFetch";
import type { TrainingSession, TrainingDrill } from "@/lib/training";
import { SESSION_TYPE_LABELS, SESSION_TYPE_COLOURS } from "@/lib/training";

const API = process.env.NEXT_PUBLIC_API_URL;

interface ListItem { id: string; name: string; date: string; }

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

// ─── Dropdown ─────────────────────────────────────────────────────────────────

function ItemDropdown({
  items, selectedId, onSelect, placeholder,
}: {
  items: ListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = items.find((i) => i.id === selectedId);

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full bg-white/10 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-left flex items-center justify-between hover:border-white/25 focus:outline-none focus:border-white/50 transition-colors"
      >
        <span className={selected ? "text-white truncate" : "text-white/30"}>
          {selected ? selected.name : placeholder}
        </span>
        <svg className={`w-4 h-4 text-white/40 shrink-0 ml-2 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && items.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#111] border border-white/15 rounded-xl shadow-2xl z-50 overflow-hidden max-h-64 overflow-y-auto">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => { onSelect(item.id); setOpen(false); }}
              className={`w-full text-left px-4 py-3 text-sm flex items-center justify-between hover:bg-white/10 transition-colors ${selectedId === item.id ? "bg-white/10 text-white" : "text-white/70"}`}
            >
              <span className="truncate">{item.name}</span>
              <span className="text-white/30 text-xs shrink-0 ml-3">{formatDate(item.date)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toBullets(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value.split(/\n+/).map((s) => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
}

function BulletList({ items, colour = "bg-white/30" }: { items: string[]; colour?: string }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-white/70">
          <span className={`w-1.5 h-1.5 rounded-full ${colour} mt-1.5 shrink-0`} />
          {item}
        </li>
      ))}
    </ul>
  );
}

// ─── Drill card ───────────────────────────────────────────────────────────────

function DrillCard({ drill, index }: { drill: TrainingDrill; index: number }) {
  const sections: { label: string; items: string[]; colour: string }[] = [
    { label: "Reason", items: toBullets(drill.reason ?? drill.evidence_link), colour: "bg-amber-400/60" },
    { label: "Set Up", items: toBullets(drill.setup), colour: "bg-blue-400/60" },
    { label: "Key Focus", items: toBullets(drill.key_focus), colour: "bg-green-400/60" },
    { label: "Progression", items: toBullets(drill.progression), colour: "bg-violet-400/60" },
    ...(drill.coaching_cues?.length ? [{ label: "Coaching Cues", items: drill.coaching_cues, colour: "bg-white/30" }] : []),
    ...(drill.opposition_pattern ? [{ label: "Opposition Pattern", items: [drill.opposition_pattern], colour: "bg-orange-400/60" }] : []),
  ].filter((s) => s.items.length > 0);

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <span className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/60 shrink-0">
          {index}
        </span>
        <div>
          <p className="text-white font-semibold text-sm">{drill.name}</p>
          <p className="text-white/30 text-xs">{drill.duration_mins} min</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pl-10">
        {sections.map(({ label, items, colour }) => (
          <div key={label}>
            <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">{label}</p>
            <BulletList items={items} colour={colour} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Session view (tabs) ──────────────────────────────────────────────────────

function SessionView({ session }: { session: TrainingSession }) {
  const [tab, setTab] = useState<"structure" | "drills">("structure");
  const sd = session.session_data;

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1 mb-6 w-fit">
        {(["structure", "drills"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"}`}
          >
            {t === "structure" ? "Session Structure" : "Drills"}
          </button>
        ))}
      </div>

      {tab === "structure" && (
        <div className="bg-white/3 border border-white/10 rounded-xl p-5 space-y-5">
          {/* Overview */}
          {sd.theme && (
            <div>
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">Overview</p>
              <p className="text-white/70 text-sm leading-relaxed">{sd.theme}</p>
            </div>
          )}

          {/* Session structure */}
          <div>
            <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">Session Structure</p>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-4 text-sm">
                <div className="flex items-center gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                  <span className="text-white font-semibold">Activation Game</span>
                  {sd.warm_up.name && <span className="text-white/40 text-sm">— {sd.warm_up.name}</span>}
                </div>
                <span className="text-white/30 shrink-0">{sd.warm_up.duration_mins} min</span>
              </div>
              {sd.drills.map((drill, i) => (
                <div key={i} className="flex items-center justify-between gap-4 text-sm">
                  <div className="flex items-center gap-2.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                    <span className="text-white font-semibold">{drill.name}</span>
                  </div>
                  <span className="text-white/30 shrink-0">{drill.duration_mins} min</span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-4 text-sm">
                <div className="flex items-center gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span className="text-white font-semibold">Game Scenario</span>
                </div>
                <span className="text-white/30 shrink-0">{sd.scenario_play.duration_mins} min</span>
              </div>
            </div>
          </div>

          {/* Coaching cues */}
          {((sd.coaching_cues ?? sd.coaching_notes) ?? []).length > 0 && (
            <div className="border-t border-white/8 pt-4">
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">Coaching Cues</p>
              <ul className="space-y-1.5">
                {(sd.coaching_cues ?? sd.coaching_notes ?? []).slice(0, 3).map((note, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-white/60">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400/60 mt-1.5 shrink-0" />
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "drills" && (
        <div className="space-y-4">
          {/* Activation game */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-green-500/20 flex items-center justify-center text-xs font-bold text-green-400 shrink-0">
                ✦
              </span>
              <div>
                <p className="text-white font-semibold text-sm">
                  Activation Game{sd.warm_up.name ? ` — ${sd.warm_up.name}` : ""}
                </p>
                <p className="text-white/30 text-xs">{sd.warm_up.duration_mins} min</p>
              </div>
            </div>
            <div className="pl-10">
              <BulletList items={[sd.warm_up.description]} colour="bg-green-400/60" />
            </div>
          </div>
          {sd.drills.map((drill, i) => <DrillCard key={i} drill={drill} index={i + 1} />)}
        </div>
      )}
    </div>
  );
}

// ─── Training detail panel ────────────────────────────────────────────────────

function TrainingDetail({ item, isOpposition }: { item: ListItem; isOpposition: boolean }) {
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [activeSession, setActiveSession] = useState<"fix_it" | "structure">("fix_it");

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/training-sessions?match_id=${encodeURIComponent(item.id)}`);
      if (res.ok) setSessions(await res.json());
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, [item.id]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  async function handleGenerate() {
    setGenerating(true);
    setGenError("");
    try {
      const reportType = isOpposition ? "opp_attack" : "attack";
      const sourceName = `${item.name} — ${isOpposition ? "Opposition" : "Match"}`;
      const res = await fetch("/api/training-sessions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_id: item.id,
          report_type: reportType,
          source_name: sourceName,
          team_name: isOpposition ? item.name : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate");
      await loadSessions();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setGenerating(false);
    }
  }

  // For match: find fix_it and structure sessions
  const fixItSession = sessions.find((s) => s.session_type === "match_fix_it") ?? null;
  const structureSession = sessions.find((s) => s.session_type === "match_structure") ?? null;
  const oppSession = sessions.find((s) => s.session_type === "opposition_prep") ?? null;
  const hasSessions = isOpposition ? !!oppSession : !!(fixItSession || structureSession);
  const currentSession = isOpposition ? oppSession : (activeSession === "fix_it" ? fixItSession : structureSession);

  return (
    <div>
      {/* Match session toggle (Fix It / Structure) */}
      {!isOpposition && (
        <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1 mb-6 w-fit">
          <button
            onClick={() => setActiveSession("fix_it")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeSession === "fix_it" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"}`}
          >
            Fix It
          </button>
          <button
            onClick={() => setActiveSession("structure")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeSession === "structure" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"}`}
          >
            Structure <span className="text-white/30 font-normal text-xs">(Use if no opposition analysis)</span>
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-white/30 text-sm py-10">
          <div className="w-4 h-4 border-2 border-white/20 border-t-white/50 rounded-full animate-spin" />
          Loading…
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-5">
            {currentSession ? (
              <div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${SESSION_TYPE_COLOURS[currentSession.session_type]}`}>
                  {SESSION_TYPE_LABELS[currentSession.session_type]}
                </span>
                <span className="text-white/20 text-xs ml-3">
                  Generated {new Date(currentSession.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
            ) : (
              <p className="text-white/30 text-sm">No session generated yet.</p>
            )}
            <button
              onClick={handleGenerate}
              disabled={generating}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${generating ? "bg-white/10 text-white/30 cursor-not-allowed" : "bg-white text-black hover:brightness-90 cursor-pointer"}`}
            >
              {generating ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Generating…
                </>
              ) : hasSessions ? "Regenerate" : "Generate Training Session"}
            </button>
          </div>
          {genError && <p className="text-red-400 text-sm mb-4">{genError}</p>}
          {currentSession && <SessionView key={currentSession.id} session={currentSession} />}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TrainingPage() {
  const [mode, setMode] = useState<"match" | "opposition">("match");
  const [matches, setMatches] = useState<ListItem[]>([]);
  const [opponents, setOpponents] = useState<ListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [mRes, oRes] = await Promise.all([
          apiFetch(`${API}/matches`),
          apiFetch(`${API}/opponents`),
        ]);
        const m: ListItem[] = mRes.ok ? await mRes.json() : [];
        const o: ListItem[] = oRes.ok ? await oRes.json() : [];
        setMatches(m);
        setOpponents(o);
        const first = mode === "match" ? m[0] : o[0];
        if (first) setSelectedId(first.id);
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = mode === "match" ? matches : opponents;
  const selected = items.find((i) => i.id === selectedId) ?? null;

  function switchMode(m: "match" | "opposition") {
    setMode(m);
    const list = m === "match" ? matches : opponents;
    setSelectedId(list[0]?.id ?? null);
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-6xl mx-auto">

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Training Sessions</h1>
          <p className="text-white/40 text-sm mt-1">Generate AI-powered sessions from your analysis.</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-white/30 text-sm">
            <div className="w-4 h-4 border-2 border-white/20 border-t-white/50 rounded-full animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="space-y-6">

            {/* Match / Opposition toggle + dropdown */}
            <div className="flex flex-col sm:flex-row sm:items-end gap-4">
              <div>
                <p className="text-white/40 text-xs mb-2">Source</p>
                <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1 w-fit">
                  {(["match", "opposition"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => switchMode(m)}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize transition-all ${mode === m ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="max-w-sm w-full">
                <p className="text-white/40 text-xs mb-2">{mode === "match" ? "Match" : "Opposition"}</p>
                <ItemDropdown
                  items={items}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  placeholder={mode === "match" ? "Select a match…" : "Select an opposition…"}
                />
              </div>
            </div>

            {/* Detail panel */}
            {selected && (
              <div className="bg-white/3 border border-white/10 rounded-xl p-6">
                <div className="mb-5">
                  <h2 className="text-xl font-bold text-white">{selected.name}</h2>
                  <p className="text-white/40 text-sm mt-0.5">{formatDate(selected.date)}</p>
                </div>
                <TrainingDetail key={`${mode}-${selected.id}`} item={selected} isOpposition={mode === "opposition"} />
              </div>
            )}

            {items.length === 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl px-5 py-8">
                <p className="text-white/40 text-sm">
                  No {mode === "match" ? "matches" : "opposition teams"} found.
                </p>
              </div>
            )}

          </div>
        )}

      </div>
    </main>
  );
}
