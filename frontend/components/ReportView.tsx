"use client";

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WentWellItem { header: string; bullets: string[] }
export interface WorkOn { area: string; priority: "high" | "medium"; bullets: string[] }
export interface Drill {
  priority_order: number;
  drill_name: string;
  targets: string;
  setup: string;
  key_focus: string;
  progression: string;
}
export interface ReportData {
  overview: string;
  went_well: WentWellItem[];
  work_ons: WorkOn[];
  suggested_drills: Drill[];
  created_at?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, string> = {
  high:   "bg-red-500/15 text-red-400 border border-red-500/25",
  medium: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/25",
};

function BulletList({ bullets }: { bullets: string[] }) {
  if (!bullets?.length) return null;
  return (
    <ul className="space-y-1.5 mt-2">
      {bullets.map((b, i) => (
        <li key={i} className="flex gap-2.5 text-sm text-white/65">
          <span className="text-white/25 shrink-0 mt-0.5">•</span>
          <span>{b}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Section tabs ─────────────────────────────────────────────────────────────

type Section = "overview" | "positives" | "work_ons" | "drills";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "overview",  label: "Overview" },
  { key: "positives", label: "Positives" },
  { key: "work_ons",  label: "Work Ons" },
  { key: "drills",    label: "Training Drills" },
];

// ─── ReportView ───────────────────────────────────────────────────────────────

export default function ReportView({ report }: { report: ReportData }) {
  const [section, setSection] = useState<Section>("overview");

  // Normalise went_well
  const wentWell: WentWellItem[] = (report.went_well ?? []).map((item) =>
    typeof item === "string" ? { header: item as string, bullets: [] } : item
  );

  // Normalise work_ons
  const workOns = (report.work_ons ?? []).map((wo) => ({
    ...wo,
    bullets: Array.isArray((wo as { bullets?: string[] }).bullets)
      ? (wo as { bullets: string[] }).bullets
      : [(wo as unknown as { detail: string }).detail].filter(Boolean),
  }));

  return (
    <div>
      {/* Section tabs */}
      <div className="flex gap-1 flex-wrap mb-6">
        {SECTIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all border ${
              section === key
                ? "bg-white/15 text-white border-white/20"
                : "bg-transparent text-white/40 border-white/10 hover:text-white/70 hover:border-white/20"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {section === "overview" && (
        <p className="text-white/80 text-sm leading-7">{report.overview}</p>
      )}

      {/* Positives */}
      {section === "positives" && (
        wentWell.length === 0 ? (
          <p className="text-white/30 text-sm">No positives recorded.</p>
        ) : (
          <div className="space-y-4">
            {wentWell.map((item, i) => (
              <div key={i}>
                <p className="text-white text-sm font-semibold">{item.header}</p>
                <BulletList bullets={item.bullets} />
              </div>
            ))}
          </div>
        )
      )}

      {/* Work Ons */}
      {section === "work_ons" && (
        workOns.length === 0 ? (
          <p className="text-white/30 text-sm">No work ons recorded.</p>
        ) : (
          <div className="space-y-4">
            {workOns.map((wo, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <p className="text-white font-semibold text-sm">{wo.area}</p>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${PRIORITY_STYLES[wo.priority] ?? ""}`}>
                    {wo.priority}
                  </span>
                </div>
                <BulletList bullets={wo.bullets} />
              </div>
            ))}
          </div>
        )
      )}

      {/* Training Drills */}
      {section === "drills" && (
        (report.suggested_drills ?? []).length === 0 ? (
          <p className="text-white/30 text-sm">No drills recorded.</p>
        ) : (
          <div className="space-y-4">
            {report.suggested_drills.map((drill) => (
              <div key={drill.priority_order} className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="w-5 h-5 rounded-full bg-white/10 text-white/50 text-xs font-bold flex items-center justify-center shrink-0">
                    {drill.priority_order}
                  </span>
                  <p className="text-white font-semibold text-sm">{drill.drill_name}</p>
                </div>
                <div className="space-y-1.5">
                  {[
                    { label: "Targets",     value: drill.targets },
                    { label: "Setup",       value: drill.setup },
                    { label: "Key Focus",   value: drill.key_focus },
                    { label: "Progression", value: drill.progression },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex gap-2 text-sm">
                      <span className="text-white/30 w-24 shrink-0">{label}</span>
                      <span className="text-white/65">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
