"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import type { TrainingSession, TrainingDrill } from "@/lib/training";
import { SESSION_TYPE_LABELS, SESSION_TYPE_COLOURS, sourceReportHref } from "@/lib/training";

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
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
      <div className="flex items-start gap-3">
        <span className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/60 shrink-0">
          {index}
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h4 className="text-white font-semibold">{drill.name}</h4>
            <span className="text-white/30 text-xs">{drill.duration_mins} min</span>
          </div>
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

// ─── Session view ─────────────────────────────────────────────────────────────

export default function TrainingSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dismissedFallback, setDismissedFallback] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/training-sessions/${id}`);
        if (!res.ok) throw new Error("Session not found");
        setSession(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load session");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <main className="min-h-screen px-4 py-10 flex items-center justify-center">
        <div className="flex items-center gap-2 text-white/30 text-sm">
          <div className="w-4 h-4 border-2 border-white/20 border-t-white/50 rounded-full animate-spin" />
          Loading session…
        </div>
      </main>
    );
  }

  if (error || !session) {
    return (
      <main className="min-h-screen px-4 py-10">
        <div className="max-w-4xl mx-auto">
          <p className="text-red-400 text-sm">{error || "Session not found."}</p>
          <Link href="/training" className="text-white/40 text-sm hover:text-white mt-2 inline-block">← Back to Training</Link>
        </div>
      </main>
    );
  }

  const sd = session.session_data;
  const badgeClass = SESSION_TYPE_COLOURS[session.session_type];
  const reportHref = sourceReportHref(session.report_type, session.match_id);
  const fallbackNote = session.fallback_note ?? sd.fallback_note;

  return (
    <main className="min-h-screen px-4 py-10 print:py-4 print:px-8">
      <div className="max-w-4xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/training" className="text-white/30 text-xs hover:text-white/60 transition-colors mb-3 inline-block print:hidden">
              ← Training Sessions
            </Link>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${badgeClass}`}>
                {SESSION_TYPE_LABELS[session.session_type]}
              </span>
              <span className="text-white/30 text-xs">{sd.duration_mins} min</span>
              <span className="text-white/20 text-xs">{formatDate(session.created_at)}</span>
            </div>
            <h1 className="text-2xl font-bold text-white">{session.title}</h1>
            {sd.theme && <p className="text-white/50 text-sm mt-1 leading-snug">{sd.theme}</p>}
            {session.source_name && (
              <Link href={reportHref} className="text-white/30 text-xs hover:text-white/60 underline underline-offset-2 mt-1 inline-block transition-colors">
                Generated from: {session.source_name}
              </Link>
            )}
          </div>
          <button
            onClick={() => window.print()}
            className="shrink-0 px-4 py-2 rounded-lg border border-white/15 text-white/50 text-sm font-semibold hover:text-white hover:border-white/30 transition-all print:hidden"
          >
            Print / Export PDF
          </button>
        </div>

        {/* Fallback note */}
        {fallbackNote && !dismissedFallback && (
          <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl px-5 py-4 flex items-start justify-between gap-3">
            <p className="text-amber-300 text-sm leading-relaxed">{fallbackNote}</p>
            <button
              onClick={() => setDismissedFallback(true)}
              className="shrink-0 text-amber-400/50 hover:text-amber-300 transition-colors print:hidden"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* Drills (includes activation game) */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">Drills</p>
          </div>
          <div className="space-y-4">
            {/* Activation game */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
              <div className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-full bg-green-500/20 flex items-center justify-center text-xs font-bold text-green-400 shrink-0">
                  ✦
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h4 className="text-white font-semibold">
                      Activation Game{sd.warm_up.name ? ` — ${sd.warm_up.name}` : ""}
                    </h4>
                    <span className="text-white/30 text-xs">{sd.warm_up.duration_mins} min</span>
                  </div>
                </div>
              </div>
              <div className="pl-10">
                <BulletList items={[sd.warm_up.description]} colour="bg-green-400/60" />
              </div>
            </div>
            {sd.drills.map((drill, i) => (
              <DrillCard key={i} drill={drill} index={i + 1} />
            ))}
          </div>
        </div>

        {/* Scenario play */}
        <div className="bg-white/3 border border-white/10 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">Scenario Play</p>
            <span className="text-white/25 text-xs">{sd.scenario_play.duration_mins} min</span>
          </div>
          <p className="text-white/70 text-sm leading-relaxed">{sd.scenario_play.description}</p>
        </div>

        {/* Coaching cues */}
        {(sd.coaching_cues ?? sd.coaching_notes ?? []).length > 0 && (
          <div className="bg-white/3 border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">Coaching Cues</p>
            </div>
            <ul className="space-y-2">
              {(sd.coaching_cues ?? sd.coaching_notes ?? []).map((note, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-white/70">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400/60 mt-1.5 shrink-0" />
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}

      </div>
    </main>
  );
}
