import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

function makeServiceSupabase() {
  return createServiceClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
}

async function getAuthUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional rugby union head coach with 20+ years of experience designing evidence-based training sessions at elite and semi-professional level.

Your coaching principles:
- Every drill must directly address a specific, named pattern from the match or opposition analysis. Generic drills that could apply to any team on any week are not acceptable.
- A FIX IT session isolates and corrects the 2-3 most critical execution failures from the match — missed tackles, breakdown errors, poor set-piece execution, defensive line gaps. It is deliberate and corrective. Drills are technically focused and pressure-based.
- A STRUCTURE & PATTERNS session reinforces the team's own best systems — the attack shapes, set-piece plays, and defensive structures that define their identity. It builds on what is working, not what is broken. Draw from the Positives and Strengths themes.
- An OPPOSITION PREP session equips the team to recognise, neutralise, and exploit a specific opponent's tendencies. Every drill must name the exact opposition pattern it prepares for.
- Drill progression follows: isolated skill → opposed practice → game-realistic scenario.
- The activation game introduces the session theme cognitively — it sets the mental frame for the session, not just the physical warm-up.
- Session coaching cues must be 3 short, verbally-deliverable phrases that a coach can shout on the pitch.
- When adapting a drill from the knowledge base, integrate it naturally without citing the source document or framework name.
- Be detailed and thorough in every field. Each bullet point should be a complete, specific sentence — not a fragment. Setup steps should be precise enough for a coach to run the drill without asking questions. Reason, key focus, and progression fields should each have 2-3 substantial bullets minimum.`;

// ── Format report data ────────────────────────────────────────────────────────

function formatReportForPrompt(reportData: Record<string, unknown>): string {
  const phases = (reportData.phases ?? []) as Array<{
    name: string;
    subsections: Array<{
      name: string;
      themes: Array<{
        title: string;
        summary: string;
        amend?: string;
        enhance?: string;
        suppress?: string;
        exploit?: string;
        avoid?: string;
      }>;
    }>;
  }>;

  return phases.map((phase) => {
    const subs = phase.subsections.map((sub) => {
      const themes = sub.themes.map((t) => {
        let extra = "";
        if (t.amend)    extra += `\n    How to fix: ${t.amend}`;
        if (t.enhance)  extra += `\n    How to enhance: ${t.enhance}`;
        if (t.suppress) extra += `\n    How to suppress: ${t.suppress}`;
        if (t.exploit)  extra += `\n    How to exploit: ${t.exploit}`;
        if (t.avoid)    extra += `\n    How to avoid: ${t.avoid}`;
        return `  - ${t.title}: ${t.summary}${extra}`;
      }).join("\n");
      return `${sub.name}:\n${themes || "  (none)"}`;
    }).join("\n\n");
    return `PHASE: ${phase.name.toUpperCase()}\n\n${subs}`;
  }).join("\n\n---\n\n");
}

// ── Priority theme extraction ─────────────────────────────────────────────────

function extractPriorityThemes(
  reportData: Record<string, unknown>,
  subsectionNames: string[],
  limit = 4,
): string {
  const phases = (reportData.phases ?? []) as Array<{
    subsections: Array<{ name: string; themes: Array<{ title: string; summary: string }> }>;
  }>;
  const target = new Set(subsectionNames);
  const themes: string[] = [];
  for (const phase of phases) {
    for (const sub of phase.subsections) {
      if (target.has(sub.name)) {
        for (const t of sub.themes) themes.push(`- ${t.title}: ${t.summary}`);
      }
    }
  }
  return themes.slice(0, limit).join("\n") || "(none identified)";
}

// ── Knowledge base fetching ───────────────────────────────────────────────────

const FRAMEWORK_TITLE = "Technical Report_ Strategic Framework for Professional Rugby Session Planning";

async function fetchStrategyFramework(supabase: ReturnType<typeof makeServiceSupabase>): Promise<string> {
  const { data } = await supabase
    .from("rugby_knowledge")
    .select("section_heading, content")
    .eq("report_title", FRAMEWORK_TITLE)
    .eq("category", "drills");
  if (!data?.length) return "";
  return data.map((r: { section_heading: string; content: string }) =>
    `### ${r.section_heading}\n${cleanChunk(r.content)}`
  ).join("\n\n");
}

async function embedQuery(text: string): Promise<number[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType: "RETRIEVAL_QUERY", content: { parts: [{ text }] } }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json() as { embedding?: { values?: number[] } };
    return data.embedding?.values ?? null;
  } catch { return null; }
}

type DrillChunk = { report_title: string; section_heading: string; content: string; similarity: number };

const SIMILARITY_THRESHOLD = 0.72;

async function fetchRelevantDrills(queries: string[], supabase: ReturnType<typeof makeServiceSupabase>): Promise<string> {
  if (!queries.length) return "";

  // Embed all queries in parallel
  const embeddings = await Promise.all(queries.map((q) => embedQuery(q)));

  // Search for each embedding in parallel, collect all results
  const allChunks: DrillChunk[] = [];
  await Promise.all(
    embeddings.map(async (embedding) => {
      if (!embedding) return;
      const { data } = await supabase.rpc("match_rugby_knowledge", {
        query_embedding: embedding,
        match_count: 8,
        filter_category: "drills",
      });
      if (data?.length) allChunks.push(...(data as DrillChunk[]));
    })
  );

  // Section headings that don't contain actionable drill content
  const LOW_VALUE_SECTIONS = ["OVERVIEW", "KEY TAKEAWAYS", "KEY PRINCIPLES", "COMMON MISTAKES", "HOW TO FIX", "INTRODUCTION"];

  // Filter framework chunks, weak matches, and low-value section types.
  // Deduplicate by report_title + section_heading so the same section from
  // different documents each get a slot, keeping the highest similarity copy.
  const seen = new Map<string, DrillChunk>();
  for (const chunk of allChunks) {
    if (chunk.report_title === FRAMEWORK_TITLE) continue;
    if ((chunk.similarity ?? 0) < SIMILARITY_THRESHOLD) continue;
    const headingUpper = chunk.section_heading.toUpperCase();
    if (LOW_VALUE_SECTIONS.some((s) => headingUpper.includes(s))) continue;
    const key = `${chunk.report_title}::${chunk.section_heading}`;
    const existing = seen.get(key);
    if (!existing || chunk.similarity > existing.similarity) {
      seen.set(key, chunk);
    }
  }

  // Sort: drill-content sections first (heading contains "DRILL"), then by similarity
  const isDrillSection = (h: string) => h.toUpperCase().includes("DRILL");
  const top = [...seen.values()]
    .sort((a, b) => {
      const aDrill = isDrillSection(a.section_heading) ? 1 : 0;
      const bDrill = isDrillSection(b.section_heading) ? 1 : 0;
      if (bDrill !== aDrill) return bDrill - aDrill;
      return b.similarity - a.similarity;
    })
    .slice(0, 6);

  console.log(`[RAG] queries: ${queries.length} | raw chunks: ${allChunks.length} | above threshold: ${seen.size} | injected: ${top.length}`);
  top.forEach((c) => console.log(`  → [${c.similarity.toFixed(3)}] ${c.report_title} — ${c.section_heading}`));

  if (!top.length) return "";
  return top.map((c) => `**${c.section_heading}**\n${cleanChunk(c.content)}`).join("\n\n---\n\n");
}

function buildKnowledgeQueries(reportData: Record<string, unknown>): string[] {
  const phases = (reportData.phases ?? []) as Array<{
    subsections: Array<{ name: string; themes: Array<{ title: string; summary: string }> }>;
  }>;
  const targetSections = new Set(["Work Ons", "Weaknesses", "Strengths", "Key Takeaways"]);
  const queries: string[] = [];
  for (const phase of phases) {
    for (const sub of phase.subsections) {
      if (targetSections.has(sub.name)) {
        for (const t of sub.themes) {
          // Reframe from observation language into drill-search language
          queries.push(`rugby training drill to improve: ${t.title}. ${t.summary}`);
        }
      }
    }
  }
  return queries.slice(0, 8);
}

// ── Chunk cleaning ────────────────────────────────────────────────────────────

const CHUNK_HEADER_PATTERNS = [
  "ADAPTED FROM",
  "SESSION PLANNING",
  "TECHNICAL REPORT",
  "COMMON MISTAKES",
  "HOW TO FIX",
  "FRAMEWORK —",
  "FRAMEWORK -",
  "SECTION:",
];

function cleanChunk(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      // Remove entirely uppercase lines (baked-in section headers)
      if (trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) return false;
      // Remove lines matching known document/framework header patterns
      const upper = trimmed.toUpperCase();
      return !CHUNK_HEADER_PATTERNS.some((p) => upper.includes(p));
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Shared schema blocks ──────────────────────────────────────────────────────

function knowledgeBlock(framework: string, drills: string): string {
  const INVISIBLE_INSTRUCTION = "Use this knowledge to inform your output but do not reference, cite, quote, or mention any document names, section headers, or source frameworks. The knowledge should shape your output invisibly — never surface it.";
  const parts: string[] = [];
  if (framework) parts.push(`## SESSION PLANNING FRAMEWORK\n${INVISIBLE_INSTRUCTION}\n\n${framework}`);
  if (drills) parts.push(`## RELEVANT DRILLS FROM KNOWLEDGE BASE\n${INVISIBLE_INSTRUCTION}\n\n${drills}`);
  return parts.length ? parts.join("\n\n") + "\n\n---\n\n" : "";
}

const DRILL_SCHEMA = `{
    "name": "Descriptive drill name that communicates the skill being trained",
    "duration_mins": 20,
    "reason": [
      "Specific match evidence: name the exact pattern, phase, or error this drill addresses (e.g. 'Lost 6 of 14 breakdowns in the opposition 22 — dominant tackler not being cleared')."
    ],
    "setup": [
      "Grid size and player numbers (e.g. '10m x 10m, 6 attackers vs 4 defenders')",
      "Starting positions and roles for each group",
      "Equipment required and initial ball placement"
    ],
    "key_focus": [
      "Primary technical execution demand — what must players do correctly",
      "Decision-making or communication requirement under pressure"
    ],
    "progression": [
      "Base version — unopposed or low resistance, build the correct pattern",
      "Progression 1 — add live opposition or a constraint",
      "Progression 2 — game-realistic pressure, full decision-making"
    ],
    "coaching_cues": [
      "Short cue coaches call on the pitch — e.g. 'Low and drive'",
      "Second cue",
      "Third cue"
    ]
  }`;

// ── Fix It session prompt ─────────────────────────────────────────────────────

function buildFixItPrompt(
  reportContent: string,
  priorityThemes: string,
  framework: string,
  drills: string,
): string {
  return `${knowledgeBlock(framework, drills)}## TASK: Generate a FIX IT Training Session

## SESSION CONSTRAINTS
- Session type: FIX IT — corrects the 2-3 most critical execution failures from the match
- Total duration: 90 minutes (15 min activation + 3-4 drills × 15-20 min + 20 min scenario play)
- Every drill must be technically focused and corrective — not generic or game-like
- Every drill must name the specific match pattern it corrects in the reason field
- Do NOT address positives or strengths — this session is purely corrective

## PRIORITY WORK ONS TO ADDRESS
${priorityThemes}

## FULL MATCH REPORT
${reportContent}

## STEP 1 — ANALYSIS (write this before the JSON)
In 2-3 sentences: identify which 2-3 Work On themes are the highest priority to address this week, and explain why they are most damaging to the team's performance.

## STEP 2 — OUTPUT
Generate the session as valid JSON. No markdown fences. Start the JSON with {

{
  "session": {
    "title": "Fix It — [specific theme name, e.g. 'Breakdown Accuracy']",
    "theme": "One sentence describing the execution failure being corrected and its match impact",
    "duration_mins": 90,
    "warm_up": {
      "name": "Activation game name — e.g. 'Jackals & Jackalees', 'Contest Grid', 'Body Position Rondo'",
      "duration_mins": 15,
      "description": "Describe the game rules and explicitly explain how this game introduces the session theme."
    },
    "drills": [
      ${DRILL_SCHEMA}
    ],
    "scenario_play": {
      "duration_mins": 20,
      "description": "A conditioned game with a specific rule that forces the corrected behaviour under match-realistic pressure. Name the condition explicitly — e.g. 'Turnover = restart from the opposition 22' or 'Team must win 3 consecutive breakdowns to score'."
    },
    "coaching_cues": [
      "Session-wide cue 1 — short and verbally deliverable",
      "Session-wide cue 2",
      "Session-wide cue 3"
    ]
  }
}

Include 3-4 drills. Return the analysis paragraph first, then the JSON.`;
}

// ── Structure & Patterns session prompt ──────────────────────────────────────

function buildStructurePrompt(
  reportContent: string,
  priorityThemes: string,
  framework: string,
  drills: string,
  fixItSession: Record<string, unknown>,
): string {
  const fixItDrillNames = ((fixItSession.drills ?? []) as Array<{ name: string }>)
    .map((d) => `- ${d.name}`)
    .join("\n");

  return `${knowledgeBlock(framework, drills)}## TASK: Generate a STRUCTURE & PATTERNS Training Session

## SESSION CONSTRAINTS
- Session type: STRUCTURE & PATTERNS — reinforces the team's own best systems and playing identity
- Total duration: 90 minutes (15 min activation + 3-4 drills × 15-20 min + 20 min scenario play)
- Drills must BUILD and AFFIRM good patterns — do not fix errors (that is covered by the Fix It session)
- Draw from the Positives and Strengths themes to identify what to reinforce
- Do NOT repeat any of the drills already designed in the Fix It session

## DRILLS ALREADY COVERED IN THE FIX IT SESSION (do not repeat)
${fixItDrillNames || "(none)"}

## PRIORITY POSITIVES & STRENGTHS TO REINFORCE
${priorityThemes}

## FULL MATCH REPORT
${reportContent}

## STEP 1 — ANALYSIS (write this before the JSON)
In 2-3 sentences: identify which 2-3 Positives or Strengths from the report are most worth reinforcing, and explain why building on them is a tactical priority.

## STEP 2 — OUTPUT
Generate the session as valid JSON. No markdown fences. Start the JSON with {

{
  "session": {
    "title": "Structure — [specific theme name, e.g. 'Attack Width & Ball Speed']",
    "fallback_note": "Use this session when no opposition analysis is available. Replace with the Opposition Prep session once opposition footage has been analysed.",
    "theme": "One sentence describing what system or pattern is being reinforced and why it is a competitive advantage",
    "duration_mins": 90,
    "warm_up": {
      "name": "Activation game name",
      "duration_mins": 15,
      "description": "Describe the game rules and how it introduces the session theme."
    },
    "drills": [
      ${DRILL_SCHEMA}
    ],
    "scenario_play": {
      "duration_mins": 20,
      "description": "A conditioned game that rewards the team for executing their own system well. Name the reward condition explicitly — e.g. 'Wide try = 2 points, central try = 1 point' or 'Bonus point for executing the set-piece play successfully before scoring'."
    },
    "coaching_cues": [
      "Session-wide cue 1",
      "Session-wide cue 2",
      "Session-wide cue 3"
    ]
  }
}

Include 3-4 drills. Return the analysis paragraph first, then the JSON.`;
}

// ── Opposition Prep session prompt ────────────────────────────────────────────

function buildOppositionPrompt(
  reportContent: string,
  teamName: string,
  priorityThemes: string,
  framework: string,
  drills: string,
): string {
  return `${knowledgeBlock(framework, drills)}## TASK: Generate an OPPOSITION PREP Training Session vs ${teamName}

## SESSION CONSTRAINTS
- Session type: OPPOSITION PREP — equips the team to recognise, neutralise, and exploit ${teamName}'s tendencies
- Total duration: 90 minutes (15 min activation + 3-4 drills × 15-20 min + 20 min scenario play)
- Split roughly 50/50: half the drills neutralise ${teamName}'s threats, half exploit their weaknesses
- Every drill must name the specific ${teamName} pattern it prepares for in the opposition_pattern field
- Do NOT generate generic rugby drills — every drill must be directly tied to this scouting report

## PRIORITY PATTERNS FROM SCOUTING REPORT
${priorityThemes}

## FULL OPPOSITION REPORT
${reportContent}

## STEP 1 — ANALYSIS (write this before the JSON)
In 2-3 sentences: identify the 2-3 highest-priority ${teamName} patterns to prepare for, and describe the strategic response for each.

## STEP 2 — OUTPUT
Generate the session as valid JSON. No markdown fences. Start the JSON with {

{
  "session": {
    "title": "Opposition Prep — vs ${teamName}",
    "theme": "One sentence describing the specific tactical challenge this session prepares for",
    "duration_mins": 90,
    "warm_up": {
      "name": "Activation game name",
      "duration_mins": 15,
      "description": "A game that replicates a key ${teamName} pattern so players start recognising it immediately."
    },
    "drills": [
      {
        "name": "Descriptive drill name",
        "duration_mins": 20,
        "reason": [
          "The specific ${teamName} pattern from the scouting report this drill prepares for — name it explicitly."
        ],
        "setup": [
          "Grid size and player numbers",
          "Starting positions and roles",
          "Equipment and conditions"
        ],
        "key_focus": [
          "What players must recognise or execute",
          "Communication or decision-making requirement"
        ],
        "progression": [
          "Base version — walk through the pattern recognition",
          "Progression 1 — live opposition running ${teamName}'s pattern",
          "Progression 2 — full-speed decision under match pressure"
        ],
        "coaching_cues": ["cue 1", "cue 2", "cue 3"],
        "opposition_pattern": "Name the specific ${teamName} tendency, system, or set-piece pattern this drill directly counters or exploits"
      }
    ],
    "scenario_play": {
      "duration_mins": 20,
      "description": "A conditioned game replicating a ${teamName} scenario. Defenders must call out the pattern before acting — e.g. 'Call the maul drive before they engage' or 'Name their kick-chase shape before fielding'."
    },
    "coaching_cues": [
      "Session-wide cue 1",
      "Session-wide cue 2",
      "Session-wide cue 3"
    ]
  }
}

Include 3-4 drills. Return the analysis paragraph first, then the JSON.`;
}

// ── Call Claude ───────────────────────────────────────────────────────────────

async function callClaude(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? "Claude API error");
  }
  const data = await res.json() as { content: { text: string }[] };
  return data.content[0].text;
}

function parseJson(text: string): Record<string, unknown> {
  let clean = text.replace(/```json\s*|```\s*/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end > start) clean = clean.slice(start, end + 1);
  return JSON.parse(clean);
}

// ── POST /api/training-sessions/generate ─────────────────────────────────────

export async function POST(req: NextRequest) {
  const { match_id, report_type, source_name, team_name } = await req.json() as {
    match_id: string;
    report_type: string;
    source_name: string;
    team_name?: string;
  };

  if (!match_id || !report_type) {
    return NextResponse.json({ error: "match_id and report_type are required" }, { status: 400 });
  }

  const user_id = await getAuthUserId();
  if (!user_id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = makeServiceSupabase();

  const isOpposition = report_type.startsWith("opp_");

  async function fetchReport(type: string) {
    const { data } = await supabase
      .from("session_reports")
      .select("id, report_data")
      .eq("session_id", match_id)
      .eq("report_type", type)
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    return data ?? null;
  }

  // For match sessions fetch both attack + defence reports and merge their phases so
  // the prompt sees work ons and strengths from both sides of the game.
  let session_report_id: string;
  let reportData: Record<string, unknown>;

  if (isOpposition) {
    const [oppAttack, oppDefence] = await Promise.all([
      fetchReport("opp_attack"),
      fetchReport("opp_defence"),
    ]);

    if (!oppAttack?.report_data && !oppDefence?.report_data) {
      return NextResponse.json({ error: "No report found for this match. Generate a report first." }, { status: 404 });
    }

    session_report_id = (oppAttack ?? oppDefence)!.id;
    const attackPhases = ((oppAttack?.report_data as Record<string, unknown>)?.phases ?? []) as unknown[];
    const defencePhases = ((oppDefence?.report_data as Record<string, unknown>)?.phases ?? []) as unknown[];
    reportData = { phases: [...attackPhases, ...defencePhases] };
  } else {
    const [attackReport, defenceReport] = await Promise.all([
      fetchReport("attack"),
      fetchReport("defence"),
    ]);

    if (!attackReport?.report_data && !defenceReport?.report_data) {
      return NextResponse.json({ error: "No report found for this match. Generate a report first." }, { status: 404 });
    }

    // Use the attack report id as the primary reference; merge phases from both
    session_report_id = (attackReport ?? defenceReport)!.id;
    const attackPhases = ((attackReport?.report_data as Record<string, unknown>)?.phases ?? []) as unknown[];
    const defencePhases = ((defenceReport?.report_data as Record<string, unknown>)?.phases ?? []) as unknown[];
    reportData = { phases: [...attackPhases, ...defencePhases] };
  }

  const reportContent = formatReportForPrompt(reportData);

  const knowledgeQueries = buildKnowledgeQueries(reportData);
  const [framework, drills] = await Promise.all([
    fetchStrategyFramework(supabase),
    fetchRelevantDrills(knowledgeQueries, supabase),
  ]);

  try {
    if (isOpposition) {
      const priorityThemes = extractPriorityThemes(
        reportData, ["Strengths", "Weaknesses", "Key Takeaways"], 8,
      );
      const raw = await callClaude(
        buildOppositionPrompt(reportContent, team_name ?? "Opposition", priorityThemes, framework, drills),
      );
      const parsed = parseJson(raw);
      const sessionData = (parsed.session ?? parsed) as Record<string, unknown>;

      const { data: saved, error: saveError } = await supabase
        .from("training_sessions")
        .insert({
          user_id, session_report_id, match_id, report_type,
          session_type: "opposition_prep",
          title: (sessionData.title as string) ?? "Opposition Prep Session",
          theme: (sessionData.theme as string) ?? null,
          session_data: sessionData,
          fallback_note: null,
          source_name,
        })
        .select()
        .single();

      if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
      return NextResponse.json({ sessions: [saved] });

    } else {
      // Generate Fix It and Structure sessions in separate calls for higher quality
      const fixItThemes = extractPriorityThemes(reportData, ["Work Ons", "Weaknesses"], 6);
      const structureThemes = extractPriorityThemes(reportData, ["Positives", "Strengths", "Key Takeaways"], 6);

      const rawS1 = await callClaude(buildFixItPrompt(reportContent, fixItThemes, framework, drills));
      const parsedS1 = parseJson(rawS1);
      const s1 = (parsedS1.session ?? parsedS1) as Record<string, unknown>;

      const rawS2 = await callClaude(buildStructurePrompt(reportContent, structureThemes, framework, drills, s1));
      const parsedS2 = parseJson(rawS2);
      const s2 = (parsedS2.session ?? parsedS2) as Record<string, unknown>;

      const { data: saved, error: saveError } = await supabase
        .from("training_sessions")
        .insert([
          {
            user_id, session_report_id, match_id, report_type,
            session_type: "match_fix_it",
            title: (s1.title as string) ?? "Fix It Session",
            theme: (s1.theme as string) ?? null,
            session_data: s1,
            fallback_note: null,
            source_name,
          },
          {
            user_id, session_report_id, match_id, report_type,
            session_type: "match_structure",
            title: (s2.title as string) ?? "Structure & Patterns Session",
            theme: (s2.theme as string) ?? null,
            session_data: s2,
            fallback_note: (s2.fallback_note as string) ?? null,
            source_name,
          },
        ])
        .select();

      if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
      return NextResponse.json({ sessions: saved });
    }
  } catch (err) {
    console.error("[training-sessions/generate] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate sessions" },
      { status: 500 }
    );
  }
}
