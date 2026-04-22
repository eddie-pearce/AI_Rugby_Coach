import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { fetchSuggestedDrills } from "@/lib/drillSearch";

function makeServiceSupabase() {
  return createServiceClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

async function getAuthUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function fmtTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function clipTimestamp(start: number, end: number): string {
  return `${fmtTs(start)}–${fmtTs(end)}`;
}

// GET /api/generate-report?match_id=X
export async function GET(req: NextRequest) {
  const match_id = req.nextUrl.searchParams.get("match_id");
  if (!match_id) return NextResponse.json({ error: "match_id is required" }, { status: 400 });

  const user_id = await getAuthUserId();
  if (!user_id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = makeServiceSupabase();
  const { data, error } = await supabase
    .from("session_reports")
    .select("*")
    .eq("session_id", match_id)
    .eq("user_id", user_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/generate-report
// Body: { match_id, label ("Attack" | "Defence"), team_id? }
export async function POST(req: NextRequest) {
  const { match_id, label, team_id } = await req.json() as {
    match_id: string;
    label: "Attack" | "Defence";
    team_id?: string;
  };

  if (!match_id || !label) {
    return NextResponse.json({ error: "match_id and label are required" }, { status: 400 });
  }

  const user_id = await getAuthUserId();
  if (!user_id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = makeServiceSupabase();

  // Fetch clips with all fields needed for synthesis
  const { data: clips, error: clipsError } = await supabase
    .from("clips")
    .select("id, clip_url, start_time, end_time, analysis_output, pass_1_output, phase, field_zone")
    .eq("match_id", match_id)
    .eq("user_id", user_id)
    .eq("tag", label.toLowerCase())
    .eq("status", "complete")
    .eq("excluded", false)
    .not("analysis_output", "is", null);

  if (clipsError) return NextResponse.json({ error: clipsError.message }, { status: 500 });
  if (!clips || clips.length === 0) return NextResponse.json({ noClips: true });

  // Fetch team profile for context
  let coach_philosophy = "";
  let team_name = "";
  const teamQuery = team_id
    ? supabase.from("team_profiles").select("team_name, coach_philosophy").eq("id", team_id).limit(1)
    : supabase.from("team_profiles").select("team_name, coach_philosophy").limit(1);
  const { data: teamData } = await teamQuery;
  if (teamData?.[0]) {
    coach_philosophy = teamData[0].coach_philosophy ?? "";
    team_name = teamData[0].team_name ?? "";
  }

  // Build clip lookup map (clip_id → clip_url) for post-processing
  const clipUrlMap = new Map<string, string>(
    clips.map((c: { id: string; clip_url: string }) => [c.id, c.clip_url])
  );

  const phase = label.toLowerCase();

  // Aggregate Pass 1 tactical themes and systems across all clips for the synthesis header
  const allThemes: string[] = [];
  const allSystems: string[] = [];
  const phaseCounts: Record<string, number> = {};

  type ClipRow = {
    id: string;
    clip_url: string;
    start_time: number;
    end_time: number;
    analysis_output: string;
    phase?: string | null;
    field_zone?: string | null;
    pass_1_output?: Record<string, unknown> | null;
  };

  for (const c of clips as ClipRow[]) {
    const p1 = c.pass_1_output ?? {};
    const themes = (p1.tactical_themes as string[] | undefined) ?? [];
    themes.forEach((t: string) => { if (!allThemes.includes(t)) allThemes.push(t); });
    const system = (p1.attacking_system ?? p1.defensive_system) as string | undefined;
    if (system && !allSystems.includes(system)) allSystems.push(system);
    const clipPhase = c.phase ?? "Unspecified";
    phaseCounts[clipPhase] = (phaseCounts[clipPhase] ?? 0) + 1;
  }

  const phaseDistribution = Object.entries(phaseCounts)
    .map(([p, n]) => `${p}: ${n} clip${n !== 1 ? "s" : ""}`)
    .join(", ");

  // Format clips for synthesis — include full Pass 1 + Pass 2 data
  const clipLines = (clips as ClipRow[]).map((c) => {
    let p2: Record<string, unknown> = {};
    try { p2 = JSON.parse(c.analysis_output); } catch { /* use empty */ }
    const p1 = c.pass_1_output ?? {};
    const ts = clipTimestamp(c.start_time, c.end_time);
    const quality = (p1.quality_indicators as string | undefined) ?? "mixed";

    const lines: string[] = [
      `clip_id: "${c.id}" | timestamp: "${ts}" | quality: ${quality} | significance: ${p2.significance ?? "?"}`,
    ];
    if (c.phase) lines.push(`phase: ${c.phase}`);
    if (c.field_zone) lines.push(`field_zone: ${c.field_zone}`);

    // Pass 1 structural fields
    const system = (p1.attacking_system ?? p1.defensive_system) as string | undefined;
    if (system) lines.push(`system: ${system}`);
    if (p1.pre_play_structure) lines.push(`structure: ${p1.pre_play_structure}`);
    if (p1.decision_point) lines.push(`decision_point: ${p1.decision_point}`);
    if (p1.breakdown_moment) lines.push(`breakdown_moment: ${p1.breakdown_moment}`);
    const p1Themes = p1.tactical_themes as string[] | undefined;
    if (p1Themes?.length) lines.push(`tactical_themes: ${p1Themes.join(", ")}`);
    const p1Patterns = p1.patterns_observed as string[] | undefined;
    if (p1Patterns?.length) lines.push(`patterns: ${p1Patterns.join(" | ")}`);

    // Pass 2 analysis
    if (p2.intent) lines.push(`intent: ${p2.intent}`);
    if (p2.tactical_breakdown) lines.push(`tactical_breakdown: ${p2.tactical_breakdown}`);
    if (p2.execution_analysis) lines.push(`execution_analysis: ${p2.execution_analysis}`);
    const worked = (p2.what_worked as string[] | undefined) ?? [];
    const didnt = (p2.what_didnt_work as string[] | undefined) ?? [];
    if (worked.length) lines.push(`what_worked: ${JSON.stringify(worked)}`);
    if (didnt.length) lines.push(`what_didnt_work: ${JSON.stringify(didnt)}`);
    if (p2.coaching_insight) lines.push(`coaching_insight: ${p2.coaching_insight}`);

    return lines.join("\n");
  }).join("\n\n---\n\n");

  const contextHeader = [
    team_name ? `Team: ${team_name}` : "",
    coach_philosophy ? `Coach philosophy (contextual lens only): ${coach_philosophy}` : "",
  ].filter(Boolean).join("\n");

  const systemPrompt = `You are an elite rugby performance analyst producing professional coaching reports for a semi-professional coaching team.

Your job is to analyse tactical patterns and strategic tendencies — not to describe events. A coach already knows what happened. They need to know WHY it happened: what system was in play, where the structure broke down, whether this is a systemic issue or an execution error, and what the team needs to do about it.

Depth over breadth. Two well-evidenced themes with genuine tactical insight are worth more than five surface observations.
Do not describe end results. Analyse causes and structural patterns.
High-significance clips (8–10) carry more evidential weight — prioritise them when selecting clips per theme.
Return ONLY valid JSON. No markdown. No preamble.`;

  const synthesisPrompt = `${contextHeader ? `${contextHeader}\n\n` : ""}DOMINANT THEMES OBSERVED ACROSS MATCH (from video analysis):
${allThemes.length ? allThemes.join(", ") : "None identified"}

SYSTEMS OBSERVED:
${allSystems.length ? allSystems.join(", ") : "Not identified"}

PHASE DISTRIBUTION:
${phaseDistribution || "Not recorded"}

CLIPS (${(clips as ClipRow[]).length} total — each includes video analysis brief and coaching analysis):
${clipLines}

STEP 1 — ANALYSIS (respond in plain text before the JSON)
Before writing the report, reason through the following:
- What are the 2–4 dominant recurring themes across ALL clips? What connects them tactically?
- Which clips cluster together and why — what is the shared structural pattern?
- Is the dominant pattern a SYSTEM issue (design or structure) or an EXECUTION issue (individual skill or decision)?
- What is the single most important message for the coaching team this week?
- What is the balance between set piece and open play issues?
- Which themes have the strongest clip evidence (high significance scores, multiple clips)?

STEP 2 — REPORT (after your Step 1 reasoning, output the JSON report)

SUBSECTION DEFINITIONS

KEY TAKEAWAYS
The 1–2 most important themes — positive or negative — from this ${phase} phase.
These are the themes the coach MUST communicate. Prefer themes with high-significance multi-clip evidence.
Summary should be tactical and strategic — explain the structural cause, not just the event.

POSITIVES
Themes showing consistent, well-executed ${phase} patterns. 0–3 themes.
Only genuine recurring strengths — do not manufacture positives.
"enhance" field: 1–2 sentences on how to build this into an even greater tactical weapon.

WORK ONS
Themes showing clear, repeated structural or execution failures. Most critical first. 0–3 themes.
"amend" field: 1–2 sentences of specific, actionable coaching instruction — what the team needs to do differently.

CLIP RULES
- Select 2–3 clips per theme that best evidence THAT specific structural pattern
- relevance_score (1–10): how directly this clip illustrates this specific theme
- Prefer clips with higher significance scores
- description: 1 sentence — what this clip shows structurally that supports the theme
- Preserve clip_id and timestamp values exactly as given in the input

QUALITY RULES
- Do NOT invent themes not evidenced in the clips
- Clips marked quality "good" with high significance carry most evidential weight
- If fewer than 2 clips support a theme, merge or drop it
- Prefer strong evidence in fewer themes over thin coverage across many

After your Step 1 analysis, return the JSON report. No markdown fences around the JSON:
{
  "report_type": "match",
  "phases": [
    {
      "name": "${phase}",
      "subsections": [
        {
          "name": "Key Takeaways",
          "themes": [
            {
              "title": "3–5 word theme title",
              "summary": "2–3 sentence tactical coaching observation — explain the structural cause, not the event",
              "clips": [
                {
                  "clip_id": "exact clip_id from input",
                  "timestamp": "exact timestamp from input",
                  "description": "1 sentence: what this clip shows structurally that supports the theme",
                  "relevance_score": 9
                }
              ]
            }
          ]
        },
        {
          "name": "Positives",
          "themes": [
            {
              "title": "3–5 word theme title",
              "summary": "2–3 sentence tactical coaching observation",
              "enhance": "1–2 sentences on how to build this into a greater tactical weapon",
              "clips": []
            }
          ]
        },
        {
          "name": "Work Ons",
          "themes": [
            {
              "title": "3–5 word theme title",
              "summary": "2–3 sentence tactical coaching observation — explain the structural cause",
              "amend": "1–2 sentences of specific actionable coaching instruction",
              "clips": []
            }
          ]
        }
      ]
    }
  ]
}`;

  // Call Claude with system prompt for stronger role priming
  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: "user", content: synthesisPrompt }],
    }),
  });

  if (!claudeRes.ok) {
    const errData = await claudeRes.json().catch(() => ({}));
    return NextResponse.json(
      { error: (errData as { error?: { message?: string } }).error?.message ?? "AI API error" },
      { status: 500 }
    );
  }

  const claudeData = await claudeRes.json() as { content: { text: string }[] };
  const text = claudeData.content[0].text;

  let reportData: Record<string, unknown>;
  try {
    // Response contains CoT reasoning (Step 1) followed by JSON (Step 2)
    // Extract the JSON object — find the last { ... } block
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    const clean = jsonMatch[0].replace(/```json|```/g, "").trim();
    reportData = JSON.parse(clean);
  } catch {
    return NextResponse.json({ error: "Failed to parse AI response", raw: text }, { status: 500 });
  }

  // Post-process: add clip_url to every clip in the tree using our lookup map
  const phases = (reportData.phases ?? []) as Array<{
    name: string;
    suggested_drills?: unknown[];
    subsections: Array<{
      name: string;
      themes: Array<{
        title: string;
        summary: string;
        clips: Array<{ clip_id: string; clip_url?: string }>;
      }>;
    }>;
  }>;
  for (const phase_obj of phases) {
    for (const subsection of phase_obj.subsections ?? []) {
      for (const theme of subsection.themes ?? []) {
        for (const clip of theme.clips ?? []) {
          const url = clipUrlMap.get(clip.clip_id);
          if (url) clip.clip_url = url;
        }
      }
    }
  }

  // Fetch suggested drills based on Work Ons themes
  for (const phase_obj of phases) {
    const workOns = (phase_obj.subsections ?? []).find((s) => s.name === "Work Ons");
    const query = (workOns?.themes ?? [])
      .map((t) => `${t.title}: ${t.summary}`)
      .join(". ");
    if (query) {
      const drills = await fetchSuggestedDrills(query, supabase);
      if (drills.length > 0) phase_obj.suggested_drills = drills;
    }
  }

  // Save to session_reports
  const { data: saved, error: saveError } = await supabase
    .from("session_reports")
    .upsert(
      {
        session_id: match_id,
        report_type: label.toLowerCase() as "attack" | "defence",
        user_id,
        report_data: reportData,
      },
      { onConflict: "session_id,report_type" }
    )
    .select()
    .single();

  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
  return NextResponse.json(saved);
}
