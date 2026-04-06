import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

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

// GET /api/generate-report?match_id=X
// Returns any existing reports saved for this match
export async function GET(req: NextRequest) {
  const match_id = req.nextUrl.searchParams.get("match_id");
  if (!match_id) {
    return NextResponse.json({ error: "match_id is required" }, { status: 400 });
  }

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

  // Fetch all completed clips for this match + tag with analysis output
  const { data: clips, error: clipsError } = await supabase
    .from("clips")
    .select("analysis_output, label, tag")
    .eq("match_id", match_id)
    .eq("user_id", user_id)
    .eq("tag", label.toLowerCase())
    .eq("status", "complete")
    .not("analysis_output", "is", null);

  if (clipsError) return NextResponse.json({ error: clipsError.message }, { status: 500 });
  if (!clips || clips.length === 0) return NextResponse.json({ noClips: true });

  // 3. Fetch team profile
  let coach_philosophy = "";
  let team_name = "";

  const teamQuery = team_id
    ? supabase.from("team_profiles").select("team_name, coach_philosophy").eq("id", team_id).limit(1)
    : supabase.from("team_profiles").select("team_name, coach_philosophy").limit(1);

  const { data: teamData } = await teamQuery;
  if (teamData && teamData.length > 0) {
    coach_philosophy = teamData[0].coach_philosophy ?? "";
    team_name = teamData[0].team_name ?? "";
  }

  // 4. Build synthesis prompt
  const concatenatedAnalyses = clips
    .map((c: { analysis_output: string }) => c.analysis_output)
    .join("\n\n---\n\n");

  const synthesisPrompt = `You are a concise, experienced rugby ${label.toLowerCase()} analyst producing a coaching report. Write like a sharp practitioner — precise, direct, no filler.
${coach_philosophy ? `\nCoach philosophy (use as a contextual lens only, not a checklist): ${coach_philosophy}` : ""}${team_name ? `\nTeam: ${team_name}` : ""}

--- CLIP ANALYSES ---
${concatenatedAnalyses}
--- END ---

ABSOLUTE RULE: Never reference clip numbers, clip counts, or specific clips anywhere in the report. Use pattern language only: "repeatedly", "consistently", "across the majority of sequences", "in most phases", "on multiple occasions", "in several instances", etc.

---

SECTION INSTRUCTIONS:

OVERVIEW
Exactly 3 sentences. No more.
Sentence 1: The structural identity of the ${label.toLowerCase()} — how they operate and what system they run.
Sentence 2: The single most important strength observed across the session.
Sentence 3: The single most critical limitation that undermined effectiveness.
No additional context, elaboration, or qualifiers.

WENT_WELL
Each entry has a short header (the theme) and 1–3 bullet points under it.
Include only the most meaningful observations — patterns that genuinely stood out as strengths. Cut anything minor, implied, or that didn't appear consistently.
Each bullet is one concise sentence. No padding.
Err strongly toward fewer, stronger entries rather than comprehensive coverage.

WORK_ONS
Each entry has a header (the area) and a priority label: "high" or "medium" only.
Under each header, provide bullet points covering: the problem (what is happening), the consequence (why it matters), the fix (what needs to change).
Each bullet is one tight sentence. No paragraphs, no extended prose.
Order: high priority first.

SUGGESTED_DRILLS
One drill per work-on, ordered to match the work-on priority order (high first).
Each drill uses exactly these four fields — one value per field, no nested lists:
  - targets: which work-on area this drill addresses
  - setup: group size, dimensions, and roles (one sentence)
  - key_focus: the single thing coaches should watch for (one sentence)
  - progression: how to increase difficulty (one sentence)
Assign priority_order as an integer starting at 1.

---

Return ONLY a valid JSON object with this exact structure. No preamble, no markdown fences, no extra fields:
{
  "overview": "string",
  "went_well": [{ "header": "string", "bullets": ["string"] }],
  "work_ons": [{ "area": "string", "priority": "high|medium", "bullets": ["string"] }],
  "suggested_drills": [{ "priority_order": number, "drill_name": "string", "targets": "string", "setup": "string", "key_focus": "string", "progression": "string" }]
}`;

  // 5. Call Claude API
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
      { error: (errData as { error?: { message?: string } }).error?.message ?? "Claude API error" },
      { status: 500 }
    );
  }

  const claudeData = await claudeRes.json() as { content: { text: string }[] };
  const text = claudeData.content[0].text;

  // 6. Parse JSON response (strip markdown fences if present)
  let report: {
    overview: string;
    went_well: { header: string; bullets: string[] }[];
    work_ons: { area: string; priority: string; bullets: string[] }[];
    suggested_drills: { priority_order: number; drill_name: string; targets: string; setup: string; key_focus: string; progression: string }[];
  };

  try {
    const clean = text.replace(/```json|```/g, "").trim();
    report = JSON.parse(clean);
  } catch {
    return NextResponse.json({ error: "Failed to parse Claude response", raw: text }, { status: 500 });
  }

  // Sort work_ons by priority: high → medium
  report.work_ons = [...report.work_ons].sort(
    (a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99)
  );

  // Sort drills by their assigned priority_order
  report.suggested_drills = [...report.suggested_drills].sort(
    (a, b) => (a.priority_order ?? 99) - (b.priority_order ?? 99)
  );

  // 7. Save to Supabase (upsert so re-generating overwrites)
  const { data: saved, error: saveError } = await supabase
    .from("session_reports")
    .upsert(
      {
        session_id: match_id, // repurposed column — stores match_id
        report_type: label.toLowerCase() as "attack" | "defence",
        overview: report.overview,
        went_well: report.went_well,
        work_ons: report.work_ons,
        suggested_drills: report.suggested_drills,
        user_id,
      },
      { onConflict: "session_id,report_type" }
    )
    .select()
    .single();

  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
  return NextResponse.json(saved);
}
