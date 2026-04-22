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

  // Fetch clips with timestamps and IDs so we can embed them in report themes
  const { data: clips, error: clipsError } = await supabase
    .from("clips")
    .select("id, clip_url, start_time, end_time, analysis_output, pass_1_output")
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

  // Format clips for the prompt — include clip_id so Claude can reference them
  const phase = label.toLowerCase();
  const clipLines = clips.map((c: {
    id: string;
    start_time: number;
    end_time: number;
    analysis_output: string;
    pass_1_output?: { quality_indicators?: string } | null;
  }) => {
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(c.analysis_output); } catch { /* use empty */ }
    const quality = c.pass_1_output?.quality_indicators ?? "mixed";
    const ts = clipTimestamp(c.start_time, c.end_time);
    return (
      `clip_id: "${c.id}" | timestamp: "${ts}" | quality: ${quality}\n` +
      `intent: ${parsed.intent ?? ""}\n` +
      `what_worked: ${JSON.stringify(parsed.what_worked ?? [])}\n` +
      `what_didnt_work: ${JSON.stringify(parsed.what_didnt_work ?? [])}`
    );
  }).join("\n\n---\n\n");

  const contextHeader = [
    team_name ? `Team: ${team_name}` : "",
    coach_philosophy ? `Coach philosophy (contextual lens only): ${coach_philosophy}` : "",
  ].filter(Boolean).join("\n");

  const synthesisPrompt = `You are a rugby head coach producing a structured post-match ${phase} coaching report.
${contextHeader ? `\n${contextHeader}\n` : ""}
Below are ${phase} clips from the match. Each has been individually analysed.

CLIPS:
${clipLines}

YOUR TASK
Identify recurring tactical themes across these clips — not individual events.
Group clips under themes and place each theme in the correct subsection.

SUBSECTION DEFINITIONS

KEY TAKEAWAYS
The 1–2 most important themes from this ${phase} phase — positive or negative.
These are what the coach must communicate to the team. Prefer multi-clip evidence.

POSITIVES
Themes showing consistent, well-executed ${phase} patterns.
0–3 themes. Only genuine recurring strengths — do not manufacture positives.
Each theme must include an "enhance" field: 1–2 sentences on how to turn this strength into an even greater advantage. If there is genuinely nothing more to add, write "This is already a significant strength — maintain focus and consistency."

WORK ONS
Themes showing clear, repeated issues or execution failures. Most critical first.
0–3 themes.
Each theme must include an "amend" field: 1–2 sentences of specific, actionable coaching instruction on how to fix this issue.

CLIP RULES
- Select 2–3 clips per theme that most clearly demonstrate THAT specific theme
- relevance_score (1–10): how directly this clip illustrates this specific theme
- A clip may appear under multiple themes only where it directly supports the point
- description: 1 sentence — what this clip shows that supports the theme
- Preserve clip_id and timestamp values exactly as given in the input

QUALITY RULES
- Do NOT invent themes not evidenced in the clips
- "good" quality clips carry more evidential weight than "mixed" or "poor"
- If fewer than 2 clips support a theme, merge or drop it
- Prefer strong evidence in fewer themes over weak coverage across many

Return ONLY valid JSON. No markdown, no explanation:
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
              "summary": "1–2 sentence coaching observation grounded in clip evidence",
              "clips": [
                {
                  "clip_id": "clip_id value from input",
                  "timestamp": "timestamp value from input",
                  "description": "1 sentence: what this clip shows that supports the theme",
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
              "summary": "1–2 sentence coaching observation",
              "enhance": "1–2 sentences on how to elevate this strength further",
              "clips": []
            }
          ]
        },
        {
          "name": "Work Ons",
          "themes": [
            {
              "title": "3–5 word theme title",
              "summary": "1–2 sentence coaching observation",
              "amend": "1–2 sentences of specific actionable coaching instruction to fix this",
              "clips": []
            }
          ]
        }
      ]
    }
  ]
}`;

  // Call Claude
  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
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
    const clean = text.replace(/```json|```/g, "").trim();
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
