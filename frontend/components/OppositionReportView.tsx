"use client";

import { useState } from "react";
import type { StructuredReport, ReportClip, TacticalTheme, Subsection, ReportPhase, SuggestedDrill } from "@/components/ReportView";
import { SuggestedDrillsSection } from "@/components/ReportView";

export type { StructuredReport as OppositionReportData };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SUBSECTION_STYLES: Record<string, { dot: string; badge: string }> = {
  "Key Takeaways":   { dot: "bg-amber-400",  badge: "bg-amber-500/15 text-amber-300 border-amber-500/25" },
  "Strengths":       { dot: "bg-green-400",  badge: "bg-green-500/15 text-green-400 border-green-500/25" },
  "Weaknesses":      { dot: "bg-red-400",    badge: "bg-red-500/15 text-red-400 border-red-500/25" },
  "How to Defend":   { dot: "bg-blue-400",   badge: "bg-blue-500/15 text-blue-400 border-blue-500/25" },
  "How to Attack":   { dot: "bg-blue-400",   badge: "bg-blue-500/15 text-blue-400 border-blue-500/25" },
  "Suggested Drills":{ dot: "bg-violet-400", badge: "bg-violet-500/15 text-violet-400 border-violet-500/25" },
};

const DRILLS_TAB = "Suggested Drills";

function RelevanceBadge({ score }: { score: number }) {
  const colour =
    score >= 8 ? "bg-green-500/20 text-green-400 border-green-500/30" :
    score >= 5 ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
                 "bg-white/10 text-white/40 border-white/15";
  return (
    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border shrink-0 ${colour}`}>
      {score}/10
    </span>
  );
}

// ─── ClipCard ─────────────────────────────────────────────────────────────────

function ClipCard({ clip }: { clip: ReportClip }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white/4 border border-white/8 rounded-xl overflow-hidden">
      <div
        className="flex items-start gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => clip.clip_url && setOpen((p) => !p)}
        role={clip.clip_url ? "button" : undefined}
      >
        <span className="font-mono text-xs text-white/35 shrink-0 mt-0.5 w-14">{clip.timestamp}</span>
        <p className="text-white/70 text-sm flex-1 leading-snug">{clip.description}</p>
        {clip.clip_url && (
          <svg
            className={`w-4 h-4 text-white/30 shrink-0 mt-0.5 transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </div>
      {open && clip.clip_url && (
        <div className="px-4 pb-4">
          <video
            key={clip.clip_id ?? clip.timestamp}
            src={clip.clip_url}
            controls
            autoPlay
            className="w-full rounded-lg max-h-64 bg-black object-contain"
          />
        </div>
      )}
    </div>
  );
}

// ─── ThemeCard ────────────────────────────────────────────────────────────────

function ThemeCard({ theme }: { theme: TacticalTheme }) {
  const topClips = [...theme.clips]
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, 3);
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
      <div>
        <p className="text-white font-semibold text-sm">{theme.title}</p>
        <p className="text-white/55 text-sm mt-1 leading-snug">{theme.summary}</p>
      </div>
      {topClips.length > 0 && (
        <div className="space-y-2">
          <p className="text-white/25 text-xs font-semibold uppercase tracking-wider">Evidence clips</p>
          {topClips.map((clip, i) => <ClipCard key={i} clip={clip} />)}
        </div>
      )}
      {theme.suppress && (
        <div className="border-t border-white/8 pt-3">
          <p className="text-blue-400/70 text-xs font-semibold mb-1">Suppress</p>
          <p className="text-white/60 text-sm leading-relaxed">{theme.suppress}</p>
        </div>
      )}
      {theme.exploit && (
        <div className="border-t border-white/8 pt-3">
          <p className="text-orange-400/70 text-xs font-semibold mb-1">Exploit</p>
          <p className="text-white/60 text-sm leading-relaxed">{theme.exploit}</p>
        </div>
      )}
      {theme.avoid && (
        <div className="border-t border-white/8 pt-3">
          <p className="text-blue-400/70 text-xs font-semibold mb-1">Avoid</p>
          <p className="text-white/60 text-sm leading-relaxed">{theme.avoid}</p>
        </div>
      )}
    </div>
  );
}

// ─── OppKeyTakeawaysPanel ─────────────────────────────────────────────────────

function OppKeyTakeawaysPanel({ phase }: { phase: ReportPhase }) {
  const overview = phase.subsections.find((s) => s.name === "Key Takeaways")?.themes[0]?.summary ?? "";
  const strengths = phase.subsections.find((s) => s.name === "Strengths")?.themes ?? [];
  const weaknesses = phase.subsections.find((s) => s.name === "Weaknesses")?.themes ?? [];
  const howTo = phase.subsections.find((s) => s.name === "How to Defend" || s.name === "How to Attack");
  const howToLabel = phase.name === "attack" ? "How to Defend" : "How to Attack";

  return (
    <div className="space-y-6">
      {overview && (
        <div>
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">Overview</p>
          <p className="text-white/70 text-sm leading-relaxed">{overview}</p>
        </div>
      )}
      {(strengths.length > 0 || weaknesses.length > 0) && (
        <div>
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">Tactical Insight</p>
          <div className="space-y-4">
            {strengths.length > 0 && (
              <div>
                <p className="text-green-400/70 text-xs font-semibold mb-2">Strengths</p>
                <ul className="space-y-2">
                  {strengths.map((t, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-white/70">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 mt-1.5 shrink-0" />
                      <span>{t.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {weaknesses.length > 0 && (
              <div>
                <p className="text-red-400/70 text-xs font-semibold mb-2">Weaknesses</p>
                <ul className="space-y-2">
                  {weaknesses.map((t, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-white/70">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                      <span>{t.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
      {(howTo?.themes.length ?? 0) > 0 && (
        <div>
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">{howToLabel}</p>
          <ul className="space-y-2">
            {howTo!.themes.map((t, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-white/70">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                <span>{t.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── SubsectionPanel ──────────────────────────────────────────────────────────

function SubsectionPanel({ subsection }: { subsection: Subsection }) {
  if (!subsection.themes.length) {
    return <p className="text-white/25 text-sm">No themes recorded for this section.</p>;
  }
  return (
    <div className="space-y-4">
      {subsection.themes.map((theme, i) => <ThemeCard key={i} theme={theme} />)}
    </div>
  );
}

// ─── OppositionReportView ─────────────────────────────────────────────────────

export default function OppositionReportView({ report }: { report: StructuredReport }) {
  const phase = report.phases?.[0] as ReportPhase | undefined;
  const subsections = phase?.subsections ?? [];
  const hasDrills = (phase?.suggested_drills?.length ?? 0) > 0;
  const HIDDEN_TABS = new Set(["How to Defend", "How to Attack"]);
  const tabs = [...subsections.map((s) => s.name).filter((n) => !HIDDEN_TABS.has(n)), ...(hasDrills ? [DRILLS_TAB] : [])];

  const [active, setActive] = useState<string>(tabs[0] ?? "");

  if (!phase || !subsections.length) {
    return <p className="text-white/30 text-sm">No report data available.</p>;
  }

  const isDrillsTab = active === DRILLS_TAB;
  const isKeyTakeaways = active === "Key Takeaways";
  const activeSubsection = subsections.find((s) => s.name === active) ?? subsections[0];
  const styles = SUBSECTION_STYLES[active] ?? { dot: "bg-white/40", badge: "bg-white/10 text-white/50 border-white/15" };

  return (
    <div>
      {/* Subsection tabs */}
      <div className="flex gap-1 flex-wrap mb-6">
        {tabs.map((name) => {
          const s = SUBSECTION_STYLES[name] ?? { dot: "bg-white/40", badge: "" };
          const isActive = name === active;
          return (
            <button
              key={name}
              onClick={() => setActive(name)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all border ${
                isActive
                  ? "bg-white/15 text-white border-white/20"
                  : "bg-transparent text-white/40 border-white/10 hover:text-white/70 hover:border-white/20"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
              {name}
            </button>
          );
        })}
      </div>

      {isDrillsTab ? (
        <SuggestedDrillsSection drills={phase.suggested_drills as SuggestedDrill[]} />
      ) : isKeyTakeaways ? (
        <OppKeyTakeawaysPanel phase={phase} />
      ) : (
        <>
          {/* Active subsection label */}
          <div className="flex items-center gap-2 mb-4">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${styles.badge}`}>
              {active}
            </span>
            <span className="text-white/30 text-xs">
              {activeSubsection.themes.length} theme{activeSubsection.themes.length !== 1 ? "s" : ""}
            </span>
          </div>
          <SubsectionPanel subsection={activeSubsection} />
        </>
      )}
    </div>
  );
}
