import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

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

// GET /api/generate-opposition-report?match_id=X
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
    .eq("user_id", user_id)
    .in("report_type", ["opp_attack", "opp_defence"]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/generate-opposition-report
// Body: { match_id, label ("Attack" | "Defence") }
export async function POST(req: NextRequest) {
  const { match_id, label } = await req.json() as {
    match_id: string;
    label: "Attack" | "Defence";
  };

  if (!match_id || !label) {
    return NextResponse.json({ error: "match_id and label are required" }, { status: 400 });
  }

  const user_id = await getAuthUserId();
  if (!user_id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = makeServiceSupabase();

  const oppTag = `opp_${label.toLowerCase()}`;
  const { data: clips, error: clipsError } = await supabase
    .from("clips")
    .select("id, clip_url, start_time, end_time, analysis_output, pass_1_output, phase, field_zone")
    .eq("match_id", match_id)
    .eq("user_id", user_id)
    .eq("tag", oppTag)
    .eq("status", "complete")
    .eq("excluded", false)
    .not("analysis_output", "is", null);

  if (clipsError) return NextResponse.json({ error: clipsError.message }, { status: 500 });
  if (!clips || clips.length === 0) return NextResponse.json({ noClips: true });

  const clipUrlMap = new Map<string, string>(
    clips.map((c: { id: string; clip_url: string }) => [c.id, c.clip_url])
  );

  const phase = label.toLowerCase();

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

  // Aggregate themes and systems for context header
  const allThemes: string[] = [];
  const allSystems: string[] = [];
  const phaseCounts: Record<string, number> = {};

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

    const system = (p1.attacking_system ?? p1.defensive_system) as string | undefined;
    if (system) lines.push(`system: ${system}`);
    if (p1.pre_play_structure) lines.push(`structure: ${p1.pre_play_structure}`);
    const p1Themes = p1.tactical_themes as string[] | undefined;
    if (p1Themes?.length) lines.push(`tactical_themes: ${p1Themes.join(", ")}`);

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

  const systemPrompt = `You are an elite rugby performance analyst producing professional scouting reports for a semi-professional coaching team.

Your job is to analyse the OPPOSITION's tactical patterns and tendencies — identifying their strengths to prepare for and their vulnerabilities to exploit. All analysis is from OUR team's perspective. Every observation must be grounded in the clip evidence.

TONE AND LANGUAGE
Write like a head coach speaking directly to their coaching staff — confident, clear, and rugby-literate.
Use standard rugby terminology where it adds precision (gain line, breakdown, first receiver, line speed, set piece, transition, ruck, pod, channel). Do not overload with jargon — if a plain word works, use it.
Be assertive. Say "their defence breaks down at the gain line" not "it appears their defence may struggle". Avoid hedging language.
Never use filler phrases: "it is evident that", "this demonstrates", "notably", "it is worth mentioning", "overall".
Write in third person about the opposition ("they", "their attack", "the defence") — not "your opposition".

Be concise and direct. Every sentence must earn its place — no padding, no restating the obvious.
Depth over breadth. Two well-evidenced themes are worth more than five surface observations.
Do not describe end results. Analyse structural causes and patterns.
High-significance clips (8–10) carry more evidential weight.
Return ONLY valid JSON. No markdown. No preamble.`;

  const synthesisPrompt = `OPPOSITION THEMES OBSERVED (from video analysis):
${allThemes.length ? allThemes.join(", ") : "None identified"}

SYSTEMS OBSERVED:
${allSystems.length ? allSystems.join(", ") : "Not identified"}

PHASE DISTRIBUTION:
${phaseDistribution || "Not recorded"}

CLIPS (${(clips as ClipRow[]).length} total — opposition ${phase} sequences):
${clipLines}

STEP 1 — ANALYSIS (respond in plain text before the JSON)
Before writing the report, reason through the following:

First, enumerate ALL candidate themes — both strengths and vulnerabilities — across the full clip set. List every distinct structural pattern you can identify, even if it only appears in 1–2 clips. Do not filter yet.

Then reason through:
- Which are genuine recurring strengths they use consistently that we must prepare for?
- Which are genuine vulnerabilities we can exploit?
- What is their ${phase} identity — what are they trying to do and what drives it?
- What is the single most important piece of intel for our coaching team?
- Which distinct mechanisms should be separate entries rather than merged?

STEP 2 — REPORT (after your Step 1 reasoning, output the JSON report)

SUBSECTION DEFINITIONS

EXECUTIVE SUMMARY
"identity": 1–2 sentences max — their ${phase} identity: what system they run and what drives it.
"key_message": 1 sentence — the single most important scouting intel for our coaching team.
"trends": 2–3 bullets — their dominant ${phase} patterns. One clause each.

SYSTEM OVERVIEW
A single blended overview of how they structure their ${phase} game.
"description": 1–2 sentences on what their system is and how it works.
"bullets": 3–4 short structural observations. One clause each.

KEY TAKEAWAYS
3–5 most important intel points — an honest mix reflecting how dangerous or vulnerable they are in ${phase}. If their ${phase} is largely dangerous, more should be threats. If they are exploitable, more should be vulnerabilities.
"sentiment": "positive" (a threat we must prepare for) | "negative" (a vulnerability we can exploit).
No clips — headline observations only.
"summary": 2–3 bullets. One clause each.

STRENGTHS
Identify every distinct recurring threat from your Step 1 enumeration. A different structural mechanism counts as a separate entry — do not merge distinct threats. 0–5 themes.
"summary": 2–3 bullets — what they do well and why it works structurally. One clause each.
"prepare": 1 sentence max — how we counteract or prepare for this threat specifically.

VULNERABILITIES
Most exploitable weaknesses in their ${phase}. Most critical first. 0–4 themes.
"type": exactly one of "System" (structural/design weakness), "Execution" (skill, timing, or communication failure), or "Hybrid".
"summary": 2–3 bullets — the structural cause of the vulnerability. One clause each, specific.
"exploit": 1 sentence max — how we attack this weakness. Concrete and direct.

PREPARATION FOCUS
Synthesise across Strengths and Vulnerabilities into 4–6 preparation recommendations.
Strengths → "counter" items: how we prepare to neutralise their threat in training.
Vulnerabilities → "exploit" items: how we train to target their weakness.
"title": short specific focus (e.g. "Defending Their Offload Game", "Targeting Their Blitz Line Speed")
"drill_type": type of session or drill format
"reason": one short clause — why this is needed, tied to what was observed
"source": exactly "strength" or "vulnerability"
2–4 counter items, 1–2 exploit items.

CLIP RULES
- Select 2–3 clips per theme that best evidence THAT specific structural pattern
- relevance_score (1–10): how directly this clip illustrates this specific theme
- Prefer clips with higher significance scores
- description: one short clause — what this clip shows structurally. No event narration.
- Preserve clip_id and timestamp values exactly as given in the input

QUALITY RULES
- Do NOT invent themes not evidenced in the clips
- If fewer than 2 clips support a theme, it may still be included if significance is 8+
- Prefer strong evidence in fewer themes over thin coverage across many

After your Step 1 analysis, return the JSON report. No markdown fences around the JSON:
{
  "report_type": "opposition",
  "phases": [
    {
      "name": "${phase}",
      "executive_summary": {
        "identity": "1–2 sentences on their ${phase} identity",
        "key_message": "single most important scouting intel — 1 sentence",
        "trends": ["dominant pattern 1", "dominant pattern 2", "dominant pattern 3"]
      },
      "system_overview": {
        "description": "1–2 sentences on their ${phase} system",
        "bullets": ["structural observation 1", "structural observation 2", "structural observation 3"]
      },
      "subsections": [
        {
          "name": "Key Takeaways",
          "themes": [
            {
              "title": "3–5 word theme title",
              "sentiment": "positive | negative",
              "summary": ["intel bullet 1", "intel bullet 2"],
              "clips": []
            }
          ]
        },
        {
          "name": "Strengths",
          "themes": [
            {
              "title": "3–5 word theme title",
              "summary": ["observation bullet 1", "observation bullet 2"],
              "prepare": "1 sentence — how we counteract this threat",
              "clips": []
            }
          ]
        },
        {
          "name": "Vulnerabilities",
          "themes": [
            {
              "title": "3–5 word theme title",
              "type": "System | Execution | Hybrid",
              "summary": ["vulnerability bullet 1", "vulnerability bullet 2"],
              "exploit": "1 sentence — how we attack this weakness",
              "clips": []
            }
          ]
        }
      ],
      "preparation_focus": [
        {
          "title": "short preparation focus title",
          "drill_type": "type of session or drill format",
          "reason": "one short clause — why this is needed",
          "source": "strength"
        },
        {
          "title": "short preparation focus title",
          "drill_type": "type of session or drill format",
          "reason": "one short clause — why this is needed",
          "source": "vulnerability"
        }
      ]
    }
  ]
}`;

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 12000,
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
  let cot = "";
  try {
    const jsonMatch = text.match(/\{\s*"report_type"[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    cot = text.slice(0, text.indexOf(jsonMatch[0])).trim();
    const clean = jsonMatch[0].replace(/```json|```/g, "").trim();
    reportData = JSON.parse(clean);
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to parse AI response", raw: text, detail: String(e) },
      { status: 500 }
    );
  }

  // Post-process: add clip_url to every clip in the tree
  const phases = (reportData.phases ?? []) as Array<{
    name: string;
    subsections: Array<{
      name: string;
      themes: Array<{
        title: string;
        summary: string | string[];
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

  const finalData = {
    format: "direct" as const,
    cot,
    phases,
    systems_observed: allSystems,
    phase_distribution: phaseDistribution,
  };

  const reportType = `opp_${label.toLowerCase()}` as "opp_attack" | "opp_defence";

  const { data: saved, error: saveError } = await supabase
    .from("session_reports")
    .upsert(
      { session_id: match_id, report_type: reportType, user_id, report_data: finalData },
      { onConflict: "session_id,report_type" }
    )
    .select()
    .single();

  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
  return NextResponse.json(saved);
}
