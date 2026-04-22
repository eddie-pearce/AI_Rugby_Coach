import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { fetchSuggestedDrills } from "@/lib/drillSearch";

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
    .select("id, clip_url, start_time, end_time, analysis_output")
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

  const clipLines = clips.map((c: {
    id: string;
    start_time: number;
    end_time: number;
    analysis_output: string;
  }) => {
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(c.analysis_output); } catch { /* use empty */ }
    const ts = clipTimestamp(c.start_time, c.end_time);
    return (
      `clip_id: "${c.id}" | timestamp: "${ts}"\n` +
      `intent: ${parsed.intent ?? ""}\n` +
      `what_worked: ${JSON.stringify(parsed.what_worked ?? [])}\n` +
      `what_didnt_work: ${JSON.stringify(parsed.what_didnt_work ?? [])}`
    );
  }).join("\n\n---\n\n");

  const isAttack = label === "Attack";
  const synthesisPrompt = isAttack
    ? buildAttackPrompt(clipLines)
    : buildDefencePrompt(clipLines);

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8096,
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
    let clean = text.replace(/```json\s*|```\s*/g, "").trim();
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start !== -1 && end > start) clean = clean.slice(start, end + 1);
    reportData = JSON.parse(clean);
  } catch {
    console.error("Failed to parse AI response. Raw text:", text);
    return NextResponse.json({ error: "Failed to parse AI response", raw: text }, { status: 500 });
  }

  // Resolve clip_urls in the report tree
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

  // Fetch suggested drills based on How to Defend (attack phase) or How to Attack (defence phase)
  const drillSourceSubsection = isAttack ? "How to Defend" : "How to Attack"; // unchanged — these names stayed the same
  for (const phase_obj of phases) {
    const targetSub = (phase_obj.subsections ?? []).find((s) => s.name === drillSourceSubsection);
    const query = (targetSub?.themes ?? [])
      .map((t) => `${t.title}: ${t.summary}`)
      .join(". ");
    if (query) {
      const drills = await fetchSuggestedDrills(query, supabase);
      if (drills.length > 0) phase_obj.suggested_drills = drills;
    }
  }

  const reportType = `opp_${label.toLowerCase()}` as "opp_attack" | "opp_defence";

  const { data: saved, error: saveError } = await supabase
    .from("session_reports")
    .upsert(
      { session_id: match_id, report_type: reportType, user_id, report_data: reportData },
      { onConflict: "session_id,report_type" }
    )
    .select()
    .single();

  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
  return NextResponse.json(saved);
}

// ── Prompt builders ────────────────────────────────────────────────────────────

const CLIP_RULES = `
CLIP RULES
- Select 2–3 clips per theme that most clearly demonstrate THAT specific theme
- relevance_score (1–10): how directly this clip illustrates this specific theme
- A clip may appear under multiple themes only where it directly supports the point
- description: 1 sentence — what this clip shows that supports the theme
- Preserve clip_id and timestamp values exactly as given in the input
- If fewer than 2 clips support a theme, merge or drop it`.trim();

function themeExample(extraField?: { key: string; value: string }): string {
  const extra = extraField ? `\n              "${extraField.key}": "${extraField.value}",` : "";
  return `[
            {
              "title": "3–5 word theme title",
              "summary": "1–2 sentence coaching observation grounded in clip evidence",${extra}
              "clips": [
                {
                  "clip_id": "clip_id value from input",
                  "timestamp": "timestamp value from input",
                  "description": "1 sentence: what this clip shows that supports the theme",
                  "relevance_score": 9
                }
              ]
            }
          ]`;
}

const SUBSECTION_EXTRA: Record<string, { key: string; value: string }> = {
  "Strengths (attack)":    { key: "suppress", value: "1–2 sentences: how to defensively suppress this attacking threat" },
  "Weaknesses (attack)":   { key: "exploit",  value: "1–2 sentences: how to defend to make this weakness even worse for them" },
  "Strengths (defence)":   { key: "avoid",    value: "1–2 sentences: how to attack to avoid playing into this defensive strength" },
  "Weaknesses (defence)":  { key: "exploit",  value: "1–2 sentences: how to attack to exploit this weakness" },
};

function oppJsonTemplate(phase: string, subsections: string[]): string {
  const sectionObjs = subsections.map((name) => {
    const extraKey = `${name} (${phase})`;
    const extra = SUBSECTION_EXTRA[extraKey];
    return `        {\n          "name": "${name}",\n          "themes": ${themeExample(extra)}\n        }`;
  }).join(",\n");
  return `{
  "report_type": "opposition",
  "phases": [
    {
      "name": "${phase}",
      "subsections": [
${sectionObjs}
      ]
    }
  ]
}`;
}

function buildAttackPrompt(clipLines: string): string {
  return `You are a rugby defence coach producing a structured scouting report on the OPPOSITION'S ATTACK.
All analysis is from OUR team's perspective — how WE defend THEM.

CLIPS (opposition attack sequences):
${clipLines}

YOUR TASK
Identify recurring tactical themes in their attack. Place each theme in the correct subsection.
Written for our coaching staff — what we need to know to defend against this opposition.

SUBSECTION DEFINITIONS

KEY TAKEAWAYS
Exactly 1 theme summarising their attacking identity — the system they run and what drives it.

STRENGTHS
What they consistently do well in attack that we must prepare for.
1–3 themes. Only include genuine, recurring strengths.
Each theme must include a "suppress" field: 1–2 sentences of specific defensive instruction on how to suppress this attacking threat.

WEAKNESSES
Exploitable weaknesses in their attack — where we can disrupt, turn them over, or limit damage.
1–3 themes.
Each theme must include an "exploit" field: 1–2 sentences on how to defend in a way that makes this weakness even worse for them.

Write Strengths and Weaknesses as factual observations about the opposition.

${CLIP_RULES}

Return ONLY valid JSON. No markdown, no explanation:
${oppJsonTemplate("attack", ["Key Takeaways", "Strengths", "Weaknesses", "How to Defend"])}`;
}

function buildDefencePrompt(clipLines: string): string {
  return `You are a rugby attack coach producing a structured scouting report on the OPPOSITION'S DEFENCE.
All analysis is from OUR team's perspective — how WE attack THEM.

CLIPS (opposition defence sequences):
${clipLines}

YOUR TASK
Identify recurring tactical themes in their defence. Place each theme in the correct subsection.
Written for our coaching staff — what we need to know to attack this opposition.

SUBSECTION DEFINITIONS

KEY TAKEAWAYS
Exactly 1 theme summarising their defensive identity — the system they run and what drives it.

STRENGTHS
What they consistently defend well that we must account for in attack.
1–3 themes. Only include genuine, recurring defensive strengths.
Each theme must include an "avoid" field: 1–2 sentences on how to structure our attack to avoid playing into this defensive strength.

WEAKNESSES
Exploitable gaps or vulnerabilities in their defence — where we can attack with confidence.
1–3 themes.
Each theme must include an "exploit" field: 1–2 sentences on how to attack to exploit this weakness and create scoring opportunities.

Write Strengths and Weaknesses as factual observations about the opposition.

${CLIP_RULES}

Return ONLY valid JSON. No markdown, no explanation:
${oppJsonTemplate("defence", ["Key Takeaways", "Strengths", "Weaknesses", "How to Attack"])}`;
}
