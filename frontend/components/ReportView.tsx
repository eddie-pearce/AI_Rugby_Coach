"use client";

import React, { useState } from "react";
import type { SuggestedDrill } from "@/lib/drillSearch";

// ─── Types ────────────────────────────────────────────────────────────────────

export type { SuggestedDrill };

export interface ReportClip {
  clip_id: string | null;
  clip_url?: string | null;
  timestamp: string;
  description: string;
  relevance_score: number;
}

export interface TacticalTheme {
  title: string;
  summary: string | string[];
  clips: ReportClip[];
  sentiment?: "positive" | "negative";
  type?: string;
  amend?: string;
  enhance?: string;
  prepare?: string;
  suppress?: string;
  exploit?: string;
  avoid?: string;
}

export interface Subsection {
  name: string;
  themes: TacticalTheme[];
}

export interface ReportPhase {
  name: "attack" | "defence";
  subsections: Subsection[];
  suggested_drills?: SuggestedDrill[];
}

export interface StructuredReport {
  report_type: "match" | "opposition";
  phases: ReportPhase[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SUBSECTION_STYLES: Record<string, { dot: string; badge: string }> = {
  "Key Takeaways":   { dot: "bg-amber-400",  badge: "bg-amber-500/15 text-amber-300 border-amber-500/25" },
  "Positives":       { dot: "bg-green-400",  badge: "bg-green-500/15 text-green-400 border-green-500/25" },
  "Work Ons":        { dot: "bg-red-400",    badge: "bg-red-500/15 text-red-400 border-red-500/25" },
  "Suggested Drills":{ dot: "bg-violet-400", badge: "bg-violet-500/15 text-violet-400 border-violet-500/25" },
};

const DRILLS_TAB = "Suggested Drills";

function RelevanceBadge({ score }: { score: number }) {
  const colour =
    score >= 8 ? "bg-green-500/20 text-green-400 border-green-500/30" :
    score >= 5 ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
                 "bg-white/10 text-white/60 border-white/15";
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
    <div className="bg-white/4 border border-white/10 rounded-xl overflow-hidden">
      <div
        className="flex items-start gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => clip.clip_url && setOpen((p) => !p)}
        role={clip.clip_url ? "button" : undefined}
      >
        <span className="font-mono text-xs text-white/55 shrink-0 mt-0.5 w-14">{clip.timestamp}</span>
        <p className="text-white/90 text-xs flex-1 leading-snug">{clip.description}</p>
        {clip.clip_url && (
          <svg
            className={`w-4 h-4 text-white/45 shrink-0 mt-0.5 transition-transform ${open ? "rotate-180" : ""}`}
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

export function SummaryBullets({ summary }: { summary: string | string[] }) {
  if (Array.isArray(summary)) {
    return (
      <ul className="space-y-1.5 mt-1">
        {summary.map((b, i) => (
          <li key={i} className="flex items-start gap-2.5 text-white text-sm leading-relaxed">
            <span className="w-1.5 h-1.5 rounded-full bg-white/40 mt-1.5 shrink-0" />
            {b}
          </li>
        ))}
      </ul>
    );
  }
  return <p className="text-white text-sm mt-1 leading-snug">{summary}</p>;
}

function ThemeCard({ theme, borderClass = "border-white/10" }: { theme: TacticalTheme; borderClass?: string }) {
  const topClips = [...theme.clips]
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, 3);
  return (
    <div className={`bg-white/5 border rounded-xl p-4 space-y-3 ${borderClass}`}>
      <div>
        <p className="text-white font-semibold text-base">{theme.title}</p>
        <SummaryBullets summary={theme.summary} />
      </div>
      {topClips.length > 0 && (
        <div className="space-y-2">
          <p className="text-white/85 text-xs font-bold uppercase tracking-wider">Evidence clips</p>
          {topClips.map((clip, i) => <ClipCard key={i} clip={clip} />)}
        </div>
      )}
      {theme.amend && (
        <div className="border-t border-white/10 pt-3">
          <p className="text-red-400 text-xs font-semibold mb-1">Amend</p>
          <p className="text-white/80 text-sm leading-relaxed">{theme.amend}</p>
        </div>
      )}
      {theme.enhance && (
        <div className="border-t border-white/10 pt-3">
          <p className="text-green-400 text-sm font-semibold mb-1">Enhance</p>
          <p className="text-white/80 text-sm leading-relaxed">{theme.enhance}</p>
        </div>
      )}
    </div>
  );
}

// ─── KeyTakeawaysPanel ────────────────────────────────────────────────────────

function KeyTakeawaysPanel({ phase }: { phase: ReportPhase }) {
  const overview = phase.subsections.find((s) => s.name === "Key Takeaways")?.themes[0]?.summary ?? "";
  const positives = phase.subsections.find((s) => s.name === "Positives")?.themes ?? [];
  const workOns = phase.subsections.find((s) => s.name === "Work Ons")?.themes ?? [];

  return (
    <div className="space-y-6">
      {overview && (
        <div>
          <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-2">Overview</p>
          <p className="text-white text-sm leading-relaxed">{overview}</p>
        </div>
      )}
      {positives.length > 0 && (
        <div>
          <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-3">Positives</p>
          <ul className="space-y-2">
            {positives.map((t, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-white">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 mt-1.5 shrink-0" />
                <span>{t.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {workOns.length > 0 && (
        <div>
          <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-3">Work Ons</p>
          <ul className="space-y-2">
            {workOns.map((t, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-white">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
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
    return <p className="text-white/45 text-sm">No themes recorded for this section.</p>;
  }
  return (
    <div className="space-y-4">
      {subsection.themes.map((theme, i) => <ThemeCard key={i} theme={theme} />)}
    </div>
  );
}

// ─── DrillCard ────────────────────────────────────────────────────────────────

function DrillCard({ drill }: { drill: SuggestedDrill }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <p className="text-white font-semibold text-sm">{drill.title}</p>
        <svg
          className={`w-4 h-4 text-white/45 shrink-0 ml-3 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/10 pt-3">
          {drill.setup && (
            <div>
              <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-1">Set Up</p>
              <p className="text-white text-sm leading-relaxed whitespace-pre-line">{drill.setup}</p>
            </div>
          )}
          {drill.key_focus && (
            <div>
              <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-1">Key Focus</p>
              <p className="text-white text-sm leading-relaxed whitespace-pre-line">{drill.key_focus}</p>
            </div>
          )}
          {drill.progression && (
            <div>
              <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-1">Progression</p>
              <p className="text-white text-sm leading-relaxed whitespace-pre-line">{drill.progression}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SuggestedDrillsSection ───────────────────────────────────────────────────

export function SuggestedDrillsSection({ drills }: { drills: SuggestedDrill[] }) {
  if (!drills.length) return null;
  return (
    <div className="mt-8">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-px flex-1 bg-white/10" />
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
          <span className="text-white/85 text-sm font-bold uppercase tracking-wider">Suggested Drills</span>
        </div>
        <div className="h-px flex-1 bg-white/10" />
      </div>
      <div className="space-y-3">
        {drills.map((drill, i) => <DrillCard key={i} drill={drill} />)}
      </div>
    </div>
  );
}

// ─── ProseReportView ──────────────────────────────────────────────────────────

function parseBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1
      ? <strong key={i} className="text-white font-semibold">{part}</strong>
      : part
  );
}

function renderMarkdown(raw: string): React.ReactNode[] {
  const lines = raw.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("# ")) {
      nodes.push(<h1 key={i} className="text-2xl font-bold text-white mt-10 mb-4 first:mt-0">{parseBold(line.slice(2))}</h1>);
    } else if (line.startsWith("## ")) {
      nodes.push(<h2 key={i} className="text-lg font-semibold text-white mt-8 mb-3">{parseBold(line.slice(3))}</h2>);
    } else if (line.startsWith("### ")) {
      nodes.push(<h3 key={i} className="text-base font-semibold text-white/95 mt-6 mb-2">{parseBold(line.slice(4))}</h3>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      const bullets: string[] = [];
      while (i < lines.length && (lines[i].startsWith("- ") || lines[i].startsWith("* "))) {
        bullets.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="space-y-1.5 mb-4 ml-1">
          {bullets.map((b, j) => (
            <li key={j} className="flex items-start gap-2.5 text-white text-sm leading-relaxed">
              <span className="w-1.5 h-1.5 rounded-full bg-white/40 mt-1.5 shrink-0" />
              <span>{parseBold(b)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    } else if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const [headerRow, , ...bodyRows] = tableLines;
      const headers = headerRow.split("|").slice(1, -1).map((h) => h.trim());
      const rows = bodyRows.map((r) => r.split("|").slice(1, -1).map((c) => c.trim()));
      nodes.push(
        <div key={`table-${i}`} className="overflow-x-auto mb-6">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                {headers.map((h, j) => (
                  <th key={j} className="text-left text-white/85 text-sm font-bold uppercase tracking-wider px-3 py-2 border-b border-white/10">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, j) => (
                <tr key={j} className={j % 2 === 0 ? "bg-white/3" : ""}>
                  {row.map((cell, k) => (
                    <td key={k} className="px-3 py-2 text-white/85 border-b border-white/5 leading-snug">
                      {parseBold(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    } else if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
      nodes.push(<h3 key={i} className="text-base font-semibold text-white/95 mt-6 mb-2">{line.trim().slice(2, -2)}</h3>);
    } else if (line.trim() === "" || line.startsWith("---")) {
      /* skip */
    } else {
      nodes.push(
        <p key={i} className="text-white text-sm leading-relaxed mb-3">{parseBold(line)}</p>
      );
    }
    i++;
  }
  return nodes;
}

// ─── Prose tab config ─────────────────────────────────────────────────────────

const PROSE_TABS = [
  { key: "overview",   label: "Overview",       keywords: ["executive summary", "system overview"], active: "text-white border-white/60",  inactive: "text-white/60 border-white/20 hover:text-white hover:border-white/50" },
  { key: "positives",  label: "Positives",      keywords: ["positives"],        active: "text-green-300 border-green-400",    inactive: "text-white/60 border-green-500/30 hover:text-green-300 hover:border-green-400" },
  { key: "workons",    label: "Work Ons",        keywords: ["work on"],          active: "text-red-300 border-red-400",        inactive: "text-white/60 border-red-500/30 hover:text-red-300 hover:border-red-400" },
  { key: "takeaways",  label: "Key Takeaways",   keywords: ["key takeaway", "system vs execution"], active: "text-blue-300 border-blue-400", inactive: "text-white/60 border-blue-500/30 hover:text-blue-300 hover:border-blue-400" },
  { key: "training",   label: "Training Focus",  keywords: ["training implication"], active: "text-purple-300 border-purple-400", inactive: "text-white/60 border-purple-500/30 hover:text-purple-300 hover:border-purple-400" },
];

function splitProse(prose: string): { preamble: string; sections: { heading: string; body: string }[] } {
  const parts = prose.split(/^(?=## )/m);
  const preamble = parts[0] ?? "";
  const sections = parts.slice(1).map((part) => {
    const nl = part.indexOf("\n");
    return {
      heading: nl === -1 ? part.trim() : part.slice(0, nl).trim(),
      body: nl === -1 ? "" : part.slice(nl + 1),
    };
  });
  return { preamble, sections };
}

function tabForSection(heading: string): string {
  const h = heading.toLowerCase();
  for (const tab of PROSE_TABS) {
    if (tab.keywords.some((k) => h.includes(k))) return tab.key;
  }
  return "";
}

export function ProseReportView({ prose }: { prose: string }) {
  const [activeTab, setActiveTab] = useState("overview");
  const { preamble, sections } = splitProse(prose);

  const grouped: Record<string, { heading: string; body: string }[]> = {};
  for (const tab of PROSE_TABS) grouped[tab.key] = [];
  for (const s of sections) {
    const key = tabForSection(s.heading);
    if (key) grouped[key].push(s);
  }

  const activeSections = grouped[activeTab] ?? [];

  return (
    <div>
      <div className="mb-6">{renderMarkdown(preamble)}</div>
      <div className="flex gap-1 flex-wrap mb-6">
        {PROSE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all border bg-transparent ${
              activeTab === tab.key ? tab.active : tab.inactive
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div>
        {activeSections.length === 0 ? (
          <p className="text-white/45 text-sm">No content for this section.</p>
        ) : (
          activeSections.map((s, i) => (
            <div key={i} className="mb-6">
              {renderMarkdown(`${s.heading}\n${s.body}`)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── DirectReportView ────────────────────────────────────────────────────────

export interface TrainingFocusItem {
  title: string;
  drill_type: string;
  reason: string;
  source: "work_on" | "positive";
}

export interface PreparationFocusItem {
  title: string;
  drill_type: string;
  reason: string;
  source: "strength" | "vulnerability";
}

export interface DirectReportPhase {
  name: string;
  executive_summary?: {
    identity: string;
    key_message: string;
    trends: string[];
  };
  system_overview?: {
    description: string;
    bullets: string[];
  };
  subsections: Subsection[];
  training_focus?: TrainingFocusItem[];
  preparation_focus?: PreparationFocusItem[];
}

export interface DirectReport {
  format: "direct";
  cot: string;
  phases: DirectReportPhase[];
  systems_observed?: string[];
  phase_distribution?: string;
}

const DIRECT_TABS = [
  { key: "overview",   label: "Overview",      active: "text-white border-white/60",        inactive: "text-white/60 border-white/20 hover:text-white hover:border-white/50" },
  { key: "positives",  label: "Positives",     active: "text-green-300 border-green-400",   inactive: "text-white/60 border-green-500/30 hover:text-green-300 hover:border-green-400" },
  { key: "workons",    label: "Work Ons",      active: "text-red-300 border-red-400",       inactive: "text-white/60 border-red-500/30 hover:text-red-300 hover:border-red-400" },
  { key: "takeaways",  label: "Key Takeaways", active: "text-blue-300 border-blue-400",     inactive: "text-white/60 border-blue-500/30 hover:text-blue-300 hover:border-blue-400" },
  { key: "training",   label: "Training Focus",active: "text-purple-300 border-purple-400", inactive: "text-white/60 border-purple-500/30 hover:text-purple-300 hover:border-purple-400" },
];

const TYPE_BADGE: Record<string, string> = {
  System:    "bg-blue-500/15 text-blue-300 border-blue-500/25",
  Execution: "bg-orange-500/15 text-orange-300 border-orange-500/25",
  Hybrid:    "bg-purple-500/15 text-purple-300 border-purple-500/25",
};

function WorkOnCard({ theme, borderClass = "border-white/10" }: { theme: TacticalTheme; borderClass?: string }) {
  const topClips = [...theme.clips].sort((a, b) => b.relevance_score - a.relevance_score).slice(0, 3);
  return (
    <div className={`bg-white/5 border rounded-xl p-4 space-y-3 ${borderClass}`}>
      <div className="flex items-start gap-3">
        <p className="text-white font-semibold text-base">{theme.title}</p>
      </div>
      <SummaryBullets summary={theme.summary} />
      {topClips.length > 0 && (
        <div className="space-y-2">
          <p className="text-white/85 text-xs font-bold uppercase tracking-wider">Evidence clips</p>
          {topClips.map((clip, i) => <ClipCard key={i} clip={clip} />)}
        </div>
      )}
      {theme.amend && (
        <div className="border-t border-white/10 pt-3">
          <p className="text-red-400 text-sm font-semibold mb-1">Fix</p>
          <p className="text-white text-sm leading-relaxed">{theme.amend}</p>
        </div>
      )}
    </div>
  );
}

export function DirectReportView({ report }: { report: DirectReport }) {
  const [activeTab, setActiveTab] = useState("overview");
  const phase = report.phases?.[0];
  const subsections = phase?.subsections ?? [];

  const getThemes = (name: string) => subsections.find((s) => s.name === name)?.themes ?? [];

  const keyTakeaways = getThemes("Key Takeaways");
  const positives    = getThemes("Positives");
  const workOns      = getThemes("Work Ons");

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-1 flex-wrap mb-6">
        {DIRECT_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all border bg-transparent ${
              activeTab === tab.key ? tab.active : tab.inactive
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {activeTab === "overview" && (() => {
        const es = phase?.executive_summary;
        const so = phase?.system_overview;
        return (
          <div className="space-y-8">
            {es && (
              <div className="space-y-6">
                <div>
                  <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-1">Executive Summary</p>
                  <div className="h-px bg-white/10 mb-5" />
                </div>
                <div>
                  <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-2">
                    {phase?.name === "attack" ? "Attacking Identity" : "Defensive Identity"}
                  </p>
                  <p className="text-white text-sm leading-relaxed">{es.identity}</p>
                </div>
                <div className="bg-white/5 border border-white/15 rounded-xl px-4 py-4">
                  <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-2">Key Coaching Message</p>
                  <p className="text-white/90 text-sm leading-snug">{es.key_message}</p>
                </div>
                {es.trends && es.trends.length > 0 && (
                  <div>
                    <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-3">Game Defining Trends</p>
                    <ul className="space-y-2">
                      {es.trends.map((t, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-white text-sm leading-relaxed">
                          <span className="w-1.5 h-1.5 rounded-full bg-white/40 mt-1.5 shrink-0" />
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {so && (so.description || so.bullets?.length > 0) && (
              <div className="space-y-3">
                <div>
                  <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-1">
                    {phase?.name === "attack" ? "Attacking System Overview" : "Defensive System Overview"}
                  </p>
                  <div className="h-px bg-white/10 mb-4" />
                </div>
                <div className="bg-white/3 border border-white/10 rounded-xl p-4 space-y-3">
                  {so.description && <p className="text-white text-sm leading-relaxed">{so.description}</p>}
                  {so.bullets && so.bullets.length > 0 && (
                    <ul className="space-y-1.5">
                      {so.bullets.map((b, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-white text-sm leading-relaxed">
                          <span className="w-1.5 h-1.5 rounded-full bg-white/35 mt-1.5 shrink-0" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {!es && !so && (
              <div className="bg-white/3 border border-white/10 rounded-xl p-4">
                <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-3">Analysis Reasoning</p>
                {report.cot.split(/\n+/).filter(Boolean).map((para, i) => (
                  <p key={i} className="text-white text-sm leading-relaxed mb-3">{para}</p>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Positives */}
      {activeTab === "positives" && (
        <div className="space-y-4">
          {positives.length === 0
            ? <p className="text-white/45 text-sm">No positives recorded.</p>
            : positives.map((t, i) => <ThemeCard key={i} theme={t} borderClass="border-green-500/40" />)}
        </div>
      )}

      {/* Work Ons */}
      {activeTab === "workons" && (
        <div className="space-y-4">
          {workOns.length === 0
            ? <p className="text-white/45 text-sm">No work ons recorded.</p>
            : workOns.map((t, i) => <WorkOnCard key={i} theme={t} borderClass="border-red-500/40" />)}
        </div>
      )}

      {/* Key Takeaways */}
      {activeTab === "takeaways" && (
        <div className="space-y-3">
          {keyTakeaways.length === 0 ? (
            <p className="text-white/45 text-sm">No key takeaways recorded.</p>
          ) : keyTakeaways.map((t, i) => {
            const isPositive = t.sentiment !== "negative";
            return (
              <div key={i} className={`rounded-xl p-4 space-y-2 border bg-white/5 ${isPositive ? "border-green-500/40" : "border-red-500/40"}`}>
                <div className="flex items-center gap-2">
                  <p className="text-white font-semibold text-base">{t.title}</p>
                </div>
                <SummaryBullets summary={t.summary} />
              </div>
            );
          })}
        </div>
      )}

      {/* Training Focus */}
      {activeTab === "training" && (() => {
        const items = phase?.training_focus ?? [];
        const fixes = items.filter((i) => i.source === "work_on");
        const develops = items.filter((i) => i.source === "positive");

        if (items.length === 0) {
          return <p className="text-white/45 text-sm">No training focus generated — regenerate the report to populate this tab.</p>;
        }

        return (
          <div className="space-y-8">
            {fixes.length > 0 && (
              <div className="space-y-3">
                <div>
                  <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-1">Fix Work Ons</p>
                  <div className="h-px bg-white/10 mb-4" />
                </div>
                {fixes.map((item, i) => (
                  <div key={i} className="bg-white/5 border border-red-500/20 rounded-xl p-4 space-y-2">
                    <p className="text-white/85 text-sm font-semibold uppercase tracking-wider"><span className="text-white/50">Work on: </span>{item.title}</p>
                    <p className="text-base leading-snug"><span className="text-white/50">Suggested Drill Focus: </span><span className="text-red-300 font-semibold">{item.drill_type}</span></p>
                    <p className="text-sm leading-relaxed"><span className="text-white/50">Reason: </span><span className="text-white">{item.reason}</span></p>
                  </div>
                ))}
              </div>
            )}

            {develops.length > 0 && (
              <div className="space-y-3">
                <div>
                  <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-1">Enhance Strengths</p>
                  <div className="h-px bg-white/10 mb-4" />
                </div>
                {develops.map((item, i) => (
                  <div key={i} className="bg-white/5 border border-green-500/20 rounded-xl p-4 space-y-2">
                    <p className="text-white/85 text-sm font-semibold uppercase tracking-wider"><span className="text-white/50">Strength: </span>{item.title}</p>
                    <p className="text-base leading-snug"><span className="text-white/50">Suggested Drill Focus: </span><span className="text-green-300 font-semibold">{item.drill_type}</span></p>
                    <p className="text-sm leading-relaxed"><span className="text-white/50">Reason: </span><span className="text-white">{item.reason}</span></p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── ReportView ───────────────────────────────────────────────────────────────

export default function ReportView({ report }: { report: StructuredReport }) {
  const phase = report.phases?.[0];
  const subsections = phase?.subsections ?? [];
  const hasDrills = (phase?.suggested_drills?.length ?? 0) > 0;
  const tabs = [...subsections.map((s) => s.name), ...(hasDrills ? [DRILLS_TAB] : [])];

  const [active, setActive] = useState<string>(tabs[0] ?? "");

  if (!phase || !subsections.length) {
    return <p className="text-white/45 text-sm">No report data available.</p>;
  }

  const isDrillsTab = active === DRILLS_TAB;
  const isKeyTakeaways = active === "Key Takeaways";
  const activeSubsection = subsections.find((s) => s.name === active) ?? subsections[0];
  const styles = SUBSECTION_STYLES[active] ?? { dot: "bg-white/40", badge: "bg-white/10 text-white/60 border-white/15" };

  return (
    <div>
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
                  ? "bg-white/15 text-white border-white/25"
                  : "bg-transparent text-white/60 border-white/10 hover:text-white hover:border-white/25"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
              {name}
            </button>
          );
        })}
      </div>

      {isDrillsTab ? (
        <SuggestedDrillsSection drills={phase.suggested_drills!} />
      ) : isKeyTakeaways ? (
        <KeyTakeawaysPanel phase={phase} />
      ) : (
        <>
          <div className="flex items-center gap-2 mb-4">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${styles.badge}`}>
              {active}
            </span>
            <span className="text-white/45 text-xs">
              {activeSubsection.themes.length} theme{activeSubsection.themes.length !== 1 ? "s" : ""}
            </span>
          </div>
          <SubsectionPanel subsection={activeSubsection} />
        </>
      )}
    </div>
  );
}
