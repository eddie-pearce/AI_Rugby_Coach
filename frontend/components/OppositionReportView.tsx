"use client";

import { useState } from "react";
import type { DirectReport, DirectReportPhase, TacticalTheme, ReportClip, PreparationFocusItem } from "@/components/ReportView";
import { SummaryBullets } from "@/components/ReportView";

export type { DirectReport as OppReportData };

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

// ─── StrengthCard ─────────────────────────────────────────────────────────────

function StrengthCard({ theme }: { theme: TacticalTheme }) {
  const topClips = [...theme.clips].sort((a, b) => b.relevance_score - a.relevance_score).slice(0, 3);
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
      <p className="text-white font-semibold text-sm">{theme.title}</p>
      <SummaryBullets summary={theme.summary} />
      {topClips.length > 0 && (
        <div className="space-y-2">
          <p className="text-white/85 text-xs font-bold uppercase tracking-wider">Evidence clips</p>
          {topClips.map((clip, i) => <ClipCard key={i} clip={clip} />)}
        </div>
      )}
      {theme.prepare && (
        <div className="border-t border-white/10 pt-3">
          <p className="text-blue-400 text-xs font-semibold mb-1">How to Prepare</p>
          <p className="text-white text-sm leading-relaxed">{theme.prepare}</p>
        </div>
      )}
    </div>
  );
}

// ─── VulnerabilityCard ────────────────────────────────────────────────────────

function VulnerabilityCard({ theme }: { theme: TacticalTheme }) {
  const topClips = [...theme.clips].sort((a, b) => b.relevance_score - a.relevance_score).slice(0, 3);
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
      <p className="text-white font-semibold text-sm">{theme.title}</p>
      <SummaryBullets summary={theme.summary} />
      {topClips.length > 0 && (
        <div className="space-y-2">
          <p className="text-white/85 text-xs font-bold uppercase tracking-wider">Evidence clips</p>
          {topClips.map((clip, i) => <ClipCard key={i} clip={clip} />)}
        </div>
      )}
      {theme.exploit && (
        <div className="border-t border-white/10 pt-3">
          <p className="text-orange-400 text-xs font-semibold mb-1">How to Exploit</p>
          <p className="text-white text-sm leading-relaxed">{theme.exploit}</p>
        </div>
      )}
    </div>
  );
}

// ─── Tab config ───────────────────────────────────────────────────────────────

const OPP_TABS = [
  { key: "overview",        label: "Overview",        active: "text-white border-white/60",        inactive: "text-white/60 border-white/20 hover:text-white hover:border-white/50" },
  { key: "strengths",       label: "Strengths",       active: "text-green-300 border-green-400",   inactive: "text-white/60 border-green-500/30 hover:text-green-300 hover:border-green-400" },
  { key: "vulnerabilities", label: "Vulnerabilities", active: "text-red-300 border-red-400",       inactive: "text-white/60 border-red-500/30 hover:text-red-300 hover:border-red-400" },
  { key: "takeaways",       label: "Key Takeaways",   active: "text-blue-300 border-blue-400",     inactive: "text-white/60 border-blue-500/30 hover:text-blue-300 hover:border-blue-400" },
  { key: "preparation",     label: "Preparation",     active: "text-purple-300 border-purple-400", inactive: "text-white/60 border-purple-500/30 hover:text-purple-300 hover:border-purple-400" },
];

// ─── OppDirectReportView ──────────────────────────────────────────────────────

export default function OppDirectReportView({ report }: { report: DirectReport }) {
  const [activeTab, setActiveTab] = useState("overview");
  const phase = report.phases?.[0] as DirectReportPhase | undefined;
  const subsections = phase?.subsections ?? [];

  const getThemes = (name: string) => subsections.find((s) => s.name === name)?.themes ?? [];
  const keyTakeaways    = getThemes("Key Takeaways");
  const strengths       = getThemes("Strengths");
  const vulnerabilities = getThemes("Vulnerabilities");

  const es = phase?.executive_summary;
  const so = phase?.system_overview;
  const prepFocus = phase?.preparation_focus ?? [];

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-1 flex-wrap mb-6">
        {OPP_TABS.map((tab) => (
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
      {activeTab === "overview" && (
        <div className="space-y-8">
          {es && (
            <div className="space-y-6">
              <div>
                <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-1">Scouting Summary</p>
                <div className="h-px bg-white/10 mb-5" />
              </div>
              <div>
                <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-2">
                  {phase?.name === "attack" ? "Their Attacking Identity" : "Their Defensive Identity"}
                </p>
                <p className="text-white text-sm leading-relaxed">{es.identity}</p>
              </div>
              <div className="bg-white/5 border border-white/15 rounded-xl px-4 py-4">
                <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-2">Key Scouting Message</p>
                <p className="text-white/90 text-sm leading-snug">{es.key_message}</p>
              </div>
              {es.trends && es.trends.length > 0 && (
                <div>
                  <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-3">Game Defining Tendencies</p>
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
                  {phase?.name === "attack" ? "Their Attacking System" : "Their Defensive System"}
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
              {(report.cot ?? "").split(/\n+/).filter(Boolean).map((para, i) => (
                <p key={i} className="text-white text-sm leading-relaxed mb-3">{para}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Strengths */}
      {activeTab === "strengths" && (
        <div className="space-y-4">
          {strengths.length === 0
            ? <p className="text-white/45 text-sm">No strengths recorded.</p>
            : strengths.map((t, i) => <StrengthCard key={i} theme={t} />)}
        </div>
      )}

      {/* Vulnerabilities */}
      {activeTab === "vulnerabilities" && (
        <div className="space-y-4">
          {vulnerabilities.length === 0
            ? <p className="text-white/45 text-sm">No vulnerabilities recorded.</p>
            : vulnerabilities.map((t, i) => <VulnerabilityCard key={i} theme={t} />)}
        </div>
      )}

      {/* Key Takeaways */}
      {activeTab === "takeaways" && (
        <div className="space-y-3">
          {keyTakeaways.length === 0 ? (
            <p className="text-white/45 text-sm">No key takeaways recorded.</p>
          ) : keyTakeaways.map((t, i) => {
            const isThreat = t.sentiment !== "negative";
            return (
              <div key={i} className={`rounded-xl p-4 space-y-2 border bg-white/5 ${isThreat ? "border-green-500/40" : "border-red-500/40"}`}>
                <div className="flex items-center gap-2">
                  <p className="text-white font-semibold text-base">{t.title}</p>
                </div>
                <SummaryBullets summary={t.summary} />
              </div>
            );
          })}
        </div>
      )}

      {/* Preparation Focus */}
      {activeTab === "preparation" && (() => {
        const counters = prepFocus.filter((i: PreparationFocusItem) => i.source === "strength");
        const exploits = prepFocus.filter((i: PreparationFocusItem) => i.source === "vulnerability");

        if (prepFocus.length === 0) {
          return <p className="text-white/45 text-sm">No preparation focus generated — regenerate the report to populate this tab.</p>;
        }

        return (
          <div className="space-y-8">
            {counters.length > 0 && (
              <div className="space-y-3">
                <div>
                  <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-1">Counter Their Strengths</p>
                  <div className="h-px bg-white/10 mb-4" />
                </div>
                {counters.map((item: PreparationFocusItem, i: number) => (
                  <div key={i} className="bg-white/5 border border-blue-500/20 rounded-xl p-4 space-y-2">
                    <p className="text-white/85 text-sm font-bold uppercase tracking-wider">{item.title}</p>
                    <p className="text-blue-300 font-semibold text-base leading-snug">{item.drill_type}</p>
                    <p className="text-white text-sm leading-relaxed">{item.reason}</p>
                  </div>
                ))}
              </div>
            )}

            {exploits.length > 0 && (
              <div className="space-y-3">
                <div>
                  <p className="text-white/85 text-sm font-bold uppercase tracking-wider mb-1">Exploit Their Vulnerabilities</p>
                  <div className="h-px bg-white/10 mb-4" />
                </div>
                {exploits.map((item: PreparationFocusItem, i: number) => (
                  <div key={i} className="bg-white/5 border border-orange-500/20 rounded-xl p-4 space-y-2">
                    <p className="text-white/85 text-sm font-bold uppercase tracking-wider">{item.title}</p>
                    <p className="text-orange-300 font-semibold text-base leading-snug">{item.drill_type}</p>
                    <p className="text-white text-sm leading-relaxed">{item.reason}</p>
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
