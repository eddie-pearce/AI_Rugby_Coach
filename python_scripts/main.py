import os
import re
import time
import tempfile
import subprocess
import json
import threading
import uuid
import requests
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from typing import Optional
from pydantic import BaseModel
from google import genai
from google.genai import types
from supabase import create_client

from automated_analysis import jobs as auto_jobs, get_job, update_job, run_automated_pipeline

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

if not all([SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY]):
    raise EnvironmentError("SUPABASE_URL, SUPABASE_SERVICE_KEY, and GEMINI_API_KEY must be set in .env")

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
gemini = genai.Client(api_key=GEMINI_API_KEY)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "https://*.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# --- Fix 2: Temp directory for local match video caching ---
# Saves re-downloading the full match from Supabase every time a clip is cut.

TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp")
os.makedirs(TEMP_DIR, exist_ok=True)

# In-memory map: storage_path → local temp file path
temp_videos: dict[str, str] = {}

# --- Ensure storage bucket exists ---

def ensure_bucket(name: str):
    buckets = supabase.storage.list_buckets()
    existing = [b.name for b in buckets]
    if name not in existing:
        supabase.storage.create_bucket(name, options={"public": True})

ensure_bucket("match-clips")


# ── Auth helper ────────────────────────────────────────────────────────────────

def get_user_id(request: Request) -> str:
    """Extract and verify the Supabase JWT from the Authorization header.
    Returns the authenticated user's UUID, or raises 401."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth[len("Bearer "):]
    try:
        user_resp = supabase.auth.get_user(token)
        return user_resp.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# --- Coach profiles ---

ATTACK_COACH_PROFILE = """
Team: Test RFC
Level: Semi-Professional
Attack Philosophy: Expansive, wide attacking rugby with emphasis on offloading and creating overlaps. Move the ball wide quickly and exploit space in wide channels.
Key Principles: Width and tempo, offload in contact, quick ball from breakdown, exploit mismatches in wide channels.
""".strip()

DEFENCE_COACH_PROFILE = """
Team: Test RFC
Level: Semi-Professional
Defence System: Blitz defence.
Defensive Principles: High line speed, press early, force errors, aggressive in the collision, hunt turnovers at the breakdown.
""".strip()

# --- Analysis instructions ---

ATTACK_INSTRUCTIONS = """
IMPORTANT — YOUR ROLE IN THIS PIPELINE:
You are not watching video. You are a rugby attack analyst working from a structured intelligence brief produced by a video analyst (the VIDEO ANALYSIS BRIEF above). Your output must be grounded solely in what that brief contains. Every sentence you write must be traceable to a specific observation in the brief. Do not use general rugby knowledge to fill gaps — if the brief does not contain enough information to complete a field, return an empty string or empty array for that field. An honest two-sentence analysis grounded in evidence is worth more than a padded response.

You are an elite rugby union attack coach with deep tactical knowledge.
The rugby knowledge base above contains relevant reference material — use it to inform the depth and precision of your analysis, not to invent observations. The coach philosophy is a contextual lens only.

ANALYSIS RULES:
- Analyse the system and structure, not the end result — a coach already knows the score
- Name attacking structures and concepts explicitly (pod system, wide shift, gate attack, crash ball, short-side strike, offload in the tackle, edge attack)
- Refer to players by role only — ball carrier, support runner, strike player, distributor — NEVER use position names or jersey numbers
- Do not reference timestamps
- Confident observations only — if the brief is insufficient for a field, leave it empty

Return ONLY a valid JSON object. No preamble, no markdown fences, no extra fields:
{
"intent": "one sentence — name the attacking system/structure and what it was designed to achieve — or empty string if unclear",
"tactical_breakdown": "2-3 sentences — what is the tactical/strategic picture: what system is in play, what are the structural dynamics, is this a system design failure or an individual execution failure — or empty string if brief is insufficient",
"execution_analysis": "2-3 sentences — what happened at the execution level: individual decisions, body positions, timing, support angles, technique — or empty string if brief is insufficient",
"what_worked": ["up to 4 items — one tight clause each, 20 words max — or empty array"],
"what_didnt_work": ["up to 4 items — one tight clause each, 20 words max — or empty array"],
"coaching_insight": "1-2 sentences — the single most important coaching point this clip surfaces — or empty string if nothing clear emerges from the brief",
"significance": 7
}
The significance field (1-10) reflects how evidentially strong and representative this clip is based on the brief: 8-10 = clear, multi-element evidence of a pattern; 5-7 = useful but partial; 1-4 = limited or ambiguous footage.
If the brief indicates insufficient footage, return: { "intent": "Insufficient footage for analysis", "tactical_breakdown": "", "execution_analysis": "", "what_worked": [], "what_didnt_work": [], "coaching_insight": "", "significance": 1 }
""".strip()

DEFENCE_INSTRUCTIONS = """
IMPORTANT — YOUR ROLE IN THIS PIPELINE:
You are not watching video. You are a rugby defence analyst working from a structured intelligence brief produced by a video analyst (the VIDEO ANALYSIS BRIEF above). Your output must be grounded solely in what that brief contains. Every sentence you write must be traceable to a specific observation in the brief. Do not use general rugby knowledge to fill gaps — if the brief does not contain enough information to complete a field, return an empty string or empty array for that field. An honest two-sentence analysis grounded in evidence is worth more than a padded response.

You are an elite rugby union defence coach with deep tactical knowledge.
The rugby knowledge base above contains relevant reference material — use it to inform the depth and precision of your analysis, not to invent observations. The coach philosophy is a contextual lens only.

ANALYSIS RULES:
- Analyse the system and structure, not the end result
- Name defensive systems and concepts explicitly (blitz, drift, man-on-man, rush defence, pillar and post, line speed, inside shoulder, choke tackle, turnover hunt)
- Refer to players by role only — defender, tackler, blitzer, pillar, sweeper — NEVER use position names or jersey numbers
- Do not reference timestamps
- Confident observations only — if the brief is insufficient for a field, leave it empty

Return ONLY a valid JSON object. No preamble, no markdown fences, no extra fields:
{
"intent": "one sentence — name the defensive system and what it was designed to achieve — or empty string if unclear",
"tactical_breakdown": "2-3 sentences — what is the tactical/strategic picture: what system is operating, what the structural dynamics are, whether this is a system failure or execution error — or empty string if brief is insufficient",
"execution_analysis": "2-3 sentences — what happened at the execution level: individual decisions, body positions, line speed, communication, tackle technique — or empty string if brief is insufficient",
"what_worked": ["up to 4 items — one tight clause each, 20 words max — or empty array"],
"what_didnt_work": ["up to 4 items — one tight clause each, 20 words max — or empty array"],
"coaching_insight": "1-2 sentences — the single most important coaching point this clip surfaces — or empty string if nothing clear emerges",
"significance": 7
}
The significance field (1-10): 8-10 = clear multi-element evidence; 5-7 = useful but partial; 1-4 = limited or ambiguous footage.
If the brief indicates insufficient footage, return: { "intent": "Insufficient footage for analysis", "tactical_breakdown": "", "execution_analysis": "", "what_worked": [], "what_didnt_work": [], "coaching_insight": "", "significance": 1 }
""".strip()

# --- Pass 1 prompts (Gemini video → JSON) ---

# Pass 1 prompts are assembled dynamically to inject phase, field_zone, and coach profile.
# These template strings are formatted at call time in build_pass1_prompt().

PASS1_ATTACK_TEMPLATE = """
You are an elite rugby union attack coach with sharp analytical instincts.
Analyse this clip of attacking play through these specific coaching lenses. Extract only what you can directly observe — do not infer, speculate, or construct a plausible answer. If a field cannot be determined from what is visible in the footage, set it to null.

CLIP CONTEXT (provided by the coach — use this to orient your analysis):
Phase: {phase}
Field Zone: {field_zone}
{coach_block}

WHAT TO OBSERVE:
- attacking_system: What structure or system is the team running? (e.g. pod system, wide shift, crash ball, short-side strike, edge attack, pick-and-go, offload game) — null if not clearly identifiable
- pre_play_structure: What is the alignment and shape before the ball moves? Width of the attack, depth of runners, pod positions, strike runner positioning — null if not clearly visible
- play_design: What specific play is being executed and what is it designed to achieve? — null if unclear
- decision_point: The key moment where a critical decision is made — what was the decision and by whom (use role only, never position name or jersey number)? — null if not clearly identifiable
- breakdown_moment: Where exactly and why does the play succeed or fail? Is this a structural issue, an individual execution error, or a defensive read? — null if unclear
- tactical_themes: Specific attacking tactical concepts observed (e.g. pod system, gate attack, wide channel overload, offload in the tackle, strike from ruck) — empty array if none clear
- patterns_observed: Specific structural patterns or execution details you can see — focus on what the team is doing systematically, not the end result — empty array if none clear
- quality_indicators: Overall execution quality — "poor", "mixed", or "good"
- context: 2 sentences max — what attacking play was attempted and what the outcome was

RULES:
- Never use position names or jersey numbers — refer to players by role only (ball carrier, support runner, strike player, distributor)
- Do not describe the end result as the analysis — describe what is happening structurally and tactically
- If you cannot clearly identify something, set it to null rather than guessing
- Only populate fields where you have direct visual evidence

Return ONLY a valid JSON object. No preamble, no markdown fences, no extra fields:
{{
"attacking_system": "string or null",
"pre_play_structure": "string or null",
"play_design": "string or null",
"decision_point": "string or null",
"breakdown_moment": "string or null",
"tactical_themes": ["array of specific concepts — empty if none clear"],
"patterns_observed": ["array of specific patterns — empty if none clear"],
"quality_indicators": "poor|mixed|good",
"context": "2 sentences max"
}}
""".strip()

PASS1_DEFENCE_TEMPLATE = """
You are an elite rugby union defence coach with sharp analytical instincts.
Analyse this clip of defensive play through these specific coaching lenses. Extract only what you can directly observe — do not infer, speculate, or construct a plausible answer. If a field cannot be determined from what is visible in the footage, set it to null.

CLIP CONTEXT (provided by the coach — use this to orient your analysis):
Phase: {phase}
Field Zone: {field_zone}
{coach_block}

WHAT TO OBSERVE:
- defensive_system: What defensive system is operating? (e.g. blitz defence, drift defence, man-on-man, rush defence, mixed) — null if not clearly identifiable
- pre_play_structure: What is the defensive alignment before the ball moves? Line depth, pillar positions, channel coverage, width — null if not clearly visible
- defensive_intent: What is the defence trying to execute? (e.g. high press / line speed, channel shutdown, choke tackle hunt, turnover at breakdown, hold the gain line) — null if unclear
- decision_point: The key moment of defensive decision — who blitzes, who drifts, who covers the kick, how does the line respond to the first receiver — null if not clearly identifiable
- breakdown_moment: Where and why does the defence succeed or hold, or where does it break down? Is this a communication failure, line speed failure, individual tackle miss, or structural gap? — null if unclear
- tactical_themes: Specific defensive tactical concepts observed (e.g. blitz, drift, pillar and post, line speed, inside shoulder, choke tackle, turnover hunt) — empty array if none clear
- patterns_observed: Specific structural patterns or execution details — focus on what the defence is doing systematically — empty array if none clear
- quality_indicators: Overall defensive execution quality — "poor", "mixed", or "good"
- context: 2 sentences max — what defensive system was operating and whether it held or broke down

RULES:
- Never use position names or jersey numbers — refer to players by role only (defender, tackler, blitzer, pillar, sweeper)
- Do not describe the end result — describe what is happening structurally and tactically
- If you cannot clearly identify something, set it to null rather than guessing
- Only populate fields where you have direct visual evidence

Return ONLY a valid JSON object. No preamble, no markdown fences, no extra fields:
{{
"defensive_system": "string or null",
"pre_play_structure": "string or null",
"defensive_intent": "string or null",
"decision_point": "string or null",
"breakdown_moment": "string or null",
"tactical_themes": ["array of specific concepts — empty if none clear"],
"patterns_observed": ["array of specific patterns — empty if none clear"],
"quality_indicators": "poor|mixed|good",
"context": "2 sentences max"
}}
""".strip()

PASS1_OPP_ATTACK_TEMPLATE = """
You are an elite rugby union scout analysing opposition attacking play on behalf of a coaching team.
Analyse this clip of the opposition's attack through specific coaching lenses. Extract only what you can directly observe — frame everything from the perspective of what our team needs to know to defend against them. If a field cannot be determined from what is visible, set it to null.

CLIP CONTEXT (provided by the coach — use this to orient your analysis):
Phase: {phase}
Field Zone: {field_zone}
{coach_block}

WHAT TO OBSERVE:
- attacking_system: What structure or system is the opposition running? (e.g. pod system, wide shift, crash ball, short-side strike) — null if not clearly identifiable
- pre_play_structure: How are they aligned before the ball moves? Width, depth, strike runner position — null if not clearly visible
- play_design: What specific play are they executing and what is it designed to achieve? — null if unclear
- decision_point: The key moment of attacking decision — what choice is made and does it work? — null if not clearly identifiable
- breakdown_moment: Where does their attack succeed or fail — and what does that tell our defence about vulnerabilities or threats? — null if unclear
- tactical_themes: Specific attacking concepts the opposition are using — frame as what our team must defend — empty array if none clear
- patterns_observed: Specific tendencies or structural patterns in their attack — frame as threats or opportunities — empty array if none clear
- quality_indicators: How effective is their attacking execution — "poor", "mixed", or "good"
- context: 2 sentences max — what attacking play they ran and how effective it was

RULES:
- Never use position names or jersey numbers
- Do not describe the end result — describe what they are doing structurally
- If you cannot clearly identify something, set it to null
- Only populate fields where you have direct visual evidence

Return ONLY a valid JSON object. No preamble, no markdown fences, no extra fields:
{{
"attacking_system": "string or null",
"pre_play_structure": "string or null",
"play_design": "string or null",
"decision_point": "string or null",
"breakdown_moment": "string or null",
"tactical_themes": ["array — empty if none clear"],
"patterns_observed": ["array — empty if none clear"],
"quality_indicators": "poor|mixed|good",
"context": "2 sentences max"
}}
""".strip()

PASS1_OPP_DEFENCE_TEMPLATE = """
You are an elite rugby union scout analysing opposition defensive play on behalf of a coaching team.
Analyse this clip of the opposition's defence through specific coaching lenses. Extract only what you can directly observe — frame everything from the perspective of what our team can exploit when attacking against them. If a field cannot be determined from what is visible, set it to null.

CLIP CONTEXT (provided by the coach — use this to orient your analysis):
Phase: {phase}
Field Zone: {field_zone}
{coach_block}

WHAT TO OBSERVE:
- defensive_system: What defensive system are the opposition running? (e.g. blitz, drift, rush, man-on-man) — null if not clearly identifiable
- pre_play_structure: How are they aligned defensively before the ball moves? — null if not clearly visible
- defensive_intent: What are they trying to do defensively? — null if unclear
- decision_point: The key moment of defensive decision and outcome — null if not clearly identifiable
- breakdown_moment: Where and why does their defence succeed or show a gap — and what can our team exploit? — null if unclear
- tactical_themes: Specific defensive concepts they are using — frame as what our team must account for or exploit — empty array if none clear
- patterns_observed: Specific tendencies or structural patterns in their defence — frame as vulnerabilities or threats — empty array if none clear
- quality_indicators: How effective is their defensive execution — "poor", "mixed", or "good"
- context: 2 sentences max — what defensive system they ran and whether it held or showed gaps

RULES:
- Never use position names or jersey numbers
- Do not describe the end result — describe what they are doing structurally
- If you cannot clearly identify something, set it to null
- Only populate fields where you have direct visual evidence

Return ONLY a valid JSON object. No preamble, no markdown fences, no extra fields:
{{
"defensive_system": "string or null",
"pre_play_structure": "string or null",
"defensive_intent": "string or null",
"decision_point": "string or null",
"breakdown_moment": "string or null",
"tactical_themes": ["array — empty if none clear"],
"patterns_observed": ["array — empty if none clear"],
"quality_indicators": "poor|mixed|good",
"context": "2 sentences max"
}}
""".strip()


def build_pass1_prompt(template: str, phase: str, field_zone: str, coach_profile: str) -> str:
    """Format a Pass 1 template with the clip's manual context and coach profile."""
    coach_block = f"Coach Context: {coach_profile}" if coach_profile else ""
    return template.format(phase=phase or "Not specified", field_zone=field_zone or "Not specified", coach_block=coach_block)

OPP_ATTACK_INSTRUCTIONS = """
IMPORTANT — YOUR ROLE IN THIS PIPELINE:
You are not watching video. You are a rugby scout working from a structured intelligence brief produced by a video analyst (the VIDEO ANALYSIS BRIEF above). Your output must be grounded solely in what that brief contains. Do not use general rugby knowledge to fill gaps — if the brief does not contain enough information to complete a field, return an empty string or empty array. Frame everything from the perspective of what our team needs to know to defend against the opposition.

You are an elite rugby union scout with deep tactical knowledge.
The rugby knowledge base above contains relevant reference material — use it to inform depth and precision, not to invent observations.

ANALYSIS RULES:
- Analyse their system and structure, framed as threats our defence must address
- Name attacking structures explicitly (pod system, wide shift, crash ball, short-side strike)
- Refer to players by role only — NEVER use position names or jersey numbers
- Do not reference timestamps
- Confident observations only — if the brief is insufficient for a field, leave it empty

Return ONLY a valid JSON object. No preamble, no markdown fences, no extra fields:
{
"intent": "one sentence — name the attacking system the opposition ran and what it was designed to achieve — or empty string if unclear",
"tactical_breakdown": "2-3 sentences — what is the tactical/strategic picture of their attack: what system is in play, what structural threats it creates for our defence — or empty string if brief is insufficient",
"execution_analysis": "2-3 sentences — what happened at the execution level in their attack: decisions, movement patterns, how well they execute their system — or empty string if brief is insufficient",
"what_worked": ["up to 4 items — what they executed well that our team must defend against — 20 words max each — or empty array"],
"what_didnt_work": ["up to 4 items — weaknesses in their attack our team can exploit — 20 words max each — or empty array"],
"coaching_insight": "1-2 sentences — the single most important scouting point for our defence from this clip — or empty string if nothing clear emerges",
"significance": 7
}
The significance field (1-10): 8-10 = clear evidence of a repeatable threat or pattern; 5-7 = useful but partial; 1-4 = limited or ambiguous.
If the brief indicates insufficient footage, return: { "intent": "Insufficient footage for analysis", "tactical_breakdown": "", "execution_analysis": "", "what_worked": [], "what_didnt_work": [], "coaching_insight": "", "significance": 1 }
""".strip()

OPP_DEFENCE_INSTRUCTIONS = """
IMPORTANT — YOUR ROLE IN THIS PIPELINE:
You are not watching video. You are a rugby scout working from a structured intelligence brief produced by a video analyst (the VIDEO ANALYSIS BRIEF above). Your output must be grounded solely in what that brief contains. Do not use general rugby knowledge to fill gaps — if the brief does not contain enough information to complete a field, return an empty string or empty array. Frame everything from the perspective of what our team can exploit when attacking against the opposition.

You are an elite rugby union scout with deep tactical knowledge.
The rugby knowledge base above contains relevant reference material — use it to inform depth and precision, not to invent observations.

ANALYSIS RULES:
- Analyse their defensive system, framed as vulnerabilities or constraints our attack must account for
- Name defensive systems explicitly (blitz, drift, rush, pillar and post, choke tackle)
- Refer to players by role only — NEVER use position names or jersey numbers
- Do not reference timestamps
- Confident observations only — if the brief is insufficient for a field, leave it empty

Return ONLY a valid JSON object. No preamble, no markdown fences, no extra fields:
{
"intent": "one sentence — name the defensive system the opposition are running and what it is designed to achieve — or empty string if unclear",
"tactical_breakdown": "2-3 sentences — what is the tactical/strategic picture of their defence: what system is in play, what constraints or vulnerabilities it creates for our attack — or empty string if brief is insufficient",
"execution_analysis": "2-3 sentences — what happened at the execution level in their defence: decisions, positioning, how well they execute their system — or empty string if brief is insufficient",
"what_worked": ["up to 4 items — what they defended well that our attack must account for — 20 words max each — or empty array"],
"what_didnt_work": ["up to 4 items — vulnerabilities in their defence our team can exploit — 20 words max each — or empty array"],
"coaching_insight": "1-2 sentences — the single most important scouting point for our attack from this clip — or empty string if nothing clear emerges",
"significance": 7
}
The significance field (1-10): 8-10 = clear repeatable vulnerability or constraint; 5-7 = useful but partial; 1-4 = limited or ambiguous.
If the brief indicates insufficient footage, return: { "intent": "Insufficient footage for analysis", "tactical_breakdown": "", "execution_analysis": "", "what_worked": [], "what_didnt_work": [], "coaching_insight": "", "significance": 1 }
""".strip()


# --- Quality gate ---

def should_skip_pass2(pass1_data: dict) -> bool:
    """Skip Pass 2 if the clip produced no usable analysis."""
    themes_empty = len(pass1_data.get("tactical_themes", [])) == 0
    quality_poor = pass1_data.get("quality_indicators", "").lower() == "poor"
    insufficient = "insufficient" in pass1_data.get("context", "").lower()
    # Also skip if the new schema fields are all null/empty — Gemini saw nothing useful
    new_fields = [
        pass1_data.get("attacking_system") or pass1_data.get("defensive_system"),
        pass1_data.get("pre_play_structure"),
        pass1_data.get("play_design") or pass1_data.get("defensive_intent"),
        pass1_data.get("breakdown_moment"),
    ]
    new_fields_empty = all(not f for f in new_fields)
    return insufficient or (themes_empty and new_fields_empty) or (quality_poor and themes_empty)


# --- Session-level theme aggregation ---

def aggregate_session_themes(pass1_results: list[dict]) -> list[str]:
    """Collect and deduplicate tactical_themes across all Pass 1 results."""
    seen: set[str] = set()
    out: list[str] = []
    for p1 in pass1_results:
        for theme in p1.get("tactical_themes", []):
            key = theme.strip().lower()
            if key and key not in seen:
                seen.add(key)
                out.append(theme.strip())
    return out


# ── Chunk cleaning ────────────────────────────────────────────────────────────

_CHUNK_HEADER_RE = re.compile(
    r"ADAPTED FROM|SESSION PLANNING|TECHNICAL REPORT|COMMON MISTAKES|HOW TO FIX|FRAMEWORK\s*[—\-]|SECTION:",
    re.IGNORECASE,
)

def clean_chunk(text: str) -> str:
    """Remove baked-in document/section headers from knowledge base chunk text."""
    lines = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            lines.append("")
            continue
        # Remove entirely uppercase lines (section headers baked into chunk content)
        if stripped == stripped.upper() and re.search(r"[A-Z]", stripped):
            continue
        # Remove lines matching known document/framework header patterns
        if _CHUNK_HEADER_RE.search(stripped):
            continue
        lines.append(line)
    cleaned = "\n".join(lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


# --- Two-pass helpers ---

def embed_query(query: str) -> list[float]:
    result = gemini.models.embed_content(
        model="models/gemini-embedding-001",
        contents=query,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY"),
    )
    return result.embeddings[0].values


def semantic_search(query: str, category: str, top_k: int = 8, min_similarity: float = 0.75) -> list[dict]:
    query_embedding = embed_query(query)
    response = supabase.rpc(
        "match_rugby_knowledge",
        {"query_embedding": query_embedding, "match_count": top_k, "filter_category": category},
    ).execute()
    results = response.data or []
    return [r for r in results if r.get("similarity", 1.0) >= min_similarity]


def multi_query_rag(themes: list[str], category: str, top_n: int = 4, min_similarity: float = 0.75) -> str:
    """Run one embedding search per theme, dedup by report_title::section_heading, return top_n chunks."""
    seen: dict[str, dict] = {}
    for theme in themes:
        try:
            results = semantic_search(theme, category=category, top_k=6, min_similarity=min_similarity)
            for r in results:
                key = f"{r.get('report_title', '')}::{r.get('section_heading', '')}"
                if key not in seen or r.get("similarity", 0) > seen[key].get("similarity", 0):
                    seen[key] = r
        except Exception:
            continue
    # Sort by similarity descending, take top_n
    ranked = sorted(seen.values(), key=lambda x: x.get("similarity", 0), reverse=True)[:top_n]
    parts = [clean_chunk(r.get("content", "")) for r in ranked if r.get("content")]
    return "\n\n---\n\n".join(p for p in parts if p)


def call_claude(prompt: str) -> str:
    if not ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY is not set in .env")
    response = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
        },
        json={
            "model": "claude-sonnet-4-6",
            "max_tokens": 3000,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=60,
    )
    response.raise_for_status()
    text = response.json()["content"][0]["text"]
    # Strip markdown fences if the model wraps JSON in ```json ... ```
    return text.replace("```json", "").replace("```", "").strip()


def assemble_pass2_prompt(
    knowledge_context: str,
    coach_profile: str,
    pass1_data: Optional[dict],
    pass1_raw: str,
    instructions: str,
    phase: str = "",
    field_zone: str = "",
) -> str:
    parts = []
    if knowledge_context:
        parts.append(
            "--- RUGBY COACHING KNOWLEDGE ---\n"
            "Use this knowledge to inform the depth and precision of your analysis but do not reference, "
            "cite, quote, or mention any document names, section headers, or source frameworks. "
            "The knowledge should shape your output invisibly — never surface it.\n\n"
            + knowledge_context
        )
    if coach_profile:
        parts.append(f"--- COACH PHILOSOPHY ---\n{coach_profile}")

    # Inject Pass 1 video intelligence brief
    if pass1_data:
        clip_lines = []

        if phase or field_zone:
            ctx_parts = []
            if phase:
                ctx_parts.append(f"Phase: {phase}")
            if field_zone:
                ctx_parts.append(f"Field Zone: {field_zone}")
            clip_lines.append("CLIP CONTEXT\n" + "\n".join(ctx_parts))

        if pass1_data.get("context"):
            clip_lines.append(f"VIDEO CONTEXT\n{pass1_data['context']}")

        # New structured fields from rebuilt Pass 1
        for label, key in [
            ("ATTACKING SYSTEM", "attacking_system"),
            ("DEFENSIVE SYSTEM", "defensive_system"),
            ("PRE-PLAY STRUCTURE", "pre_play_structure"),
            ("PLAY DESIGN", "play_design"),
            ("DEFENSIVE INTENT", "defensive_intent"),
            ("DECISION POINT", "decision_point"),
            ("BREAKDOWN MOMENT", "breakdown_moment"),
        ]:
            val = pass1_data.get(key)
            if val:
                clip_lines.append(f"{label}\n  {val}")

        if pass1_data.get("tactical_themes"):
            clip_lines.append(f"TACTICAL THEMES\n  {', '.join(pass1_data['tactical_themes'])}")

        if pass1_data.get("patterns_observed"):
            patterns = "\n".join(f"  - {p}" for p in pass1_data["patterns_observed"])
            clip_lines.append(f"PATTERNS OBSERVED\n{patterns}")

        if pass1_data.get("quality_indicators"):
            clip_lines.append(f"OVERALL QUALITY\n  {pass1_data['quality_indicators']}")

        if clip_lines:
            parts.append("--- VIDEO ANALYSIS BRIEF ---\n" + "\n\n".join(clip_lines))

    elif pass1_raw:
        parts.append(f"--- VIDEO ANALYSIS BRIEF ---\n{pass1_raw[:1500]}")

    parts.append(f"--- INSTRUCTIONS ---\n{instructions}")
    return "\n\n".join(parts)


def run_full_analysis_bg(clip_id: str, clip_path: str, clip_tag: str):
    """Background two-pass pipeline — no SSE. Updates Supabase status directly."""
    print(f"[BG] Starting analysis — clip_id={clip_id} clip_path={clip_path} tag={clip_tag}")
    try:
        # Mark as analysing
        supabase.table("clips").update({"status": "analysing"}).eq("id", clip_id).execute()
        print(f"[BG] Status set to analysing — clip_id={clip_id}")

        # Download video from Supabase storage via signed URL (supports timeout)
        print(f"[BG] Downloading from storage — path={clip_path}")
        signed = supabase.storage.from_("match-clips").create_signed_url(clip_path, 300)
        signed_url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")
        if not signed_url:
            raise Exception(f"Could not generate signed URL for {clip_path}")
        dl = requests.get(signed_url, timeout=120)
        dl.raise_for_status()
        video_bytes = dl.content
        suffix = ".webm" if clip_path.endswith(".webm") else ".mp4"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(video_bytes)
            tmp_path = tmp.name

        pass1_data = None
        pass1_text = ""

        # Fetch clip metadata (user_id, phase, field_zone) and coach profile
        clip_phase = ""
        clip_field_zone = ""
        coach_profile = ""
        try:
            clip_row = supabase.table("clips").select("user_id, phase, field_zone").eq("id", clip_id).single().execute()
            clip_user_id = clip_row.data.get("user_id") if clip_row.data else None
            clip_phase = clip_row.data.get("phase") or "" if clip_row.data else ""
            clip_field_zone = clip_row.data.get("field_zone") or "" if clip_row.data else ""
            if clip_user_id:
                profile_row = supabase.table("team_profiles").select("team_name, coach_philosophy").eq("user_id", clip_user_id).limit(1).execute()
                if profile_row.data:
                    p = profile_row.data[0]
                    profile_parts = []
                    if p.get("team_name"):
                        profile_parts.append(f"Team: {p['team_name']}")
                    if p.get("coach_philosophy"):
                        profile_parts.append(p["coach_philosophy"])
                    coach_profile = "\n".join(profile_parts)
        except Exception:
            coach_profile = ""

        try:
            if clip_tag == "attack":
                instructions = ATTACK_INSTRUCTIONS
                pass1_template = PASS1_ATTACK_TEMPLATE
            elif clip_tag == "defence":
                instructions = DEFENCE_INSTRUCTIONS
                pass1_template = PASS1_DEFENCE_TEMPLATE
            elif clip_tag == "opp_attack":
                instructions = OPP_ATTACK_INSTRUCTIONS
                pass1_template = PASS1_OPP_ATTACK_TEMPLATE
            else:  # opp_defence
                instructions = OPP_DEFENCE_INSTRUCTIONS
                pass1_template = PASS1_OPP_DEFENCE_TEMPLATE

            pass1_prompt = build_pass1_prompt(pass1_template, clip_phase, clip_field_zone, coach_profile)

            # --- Pass 1: Gemini ---
            mime_type = "video/webm" if clip_path.endswith(".webm") else "video/mp4"
            video_file = gemini.files.upload(
                file=tmp_path,
                config=types.UploadFileConfig(mime_type=mime_type),
            )
            while video_file.state.name == "PROCESSING":
                time.sleep(3)
                video_file = gemini.files.get(name=video_file.name)

            if video_file.state.name == "FAILED":
                raise Exception("Gemini video processing failed")

            pass1_response = gemini.models.generate_content(
                model="gemini-2.5-pro",
                contents=[
                    types.Part.from_uri(file_uri=video_file.uri, mime_type=mime_type),
                    pass1_prompt,
                ],
                config=types.GenerateContentConfig(
                    http_options=types.HttpOptions(timeout=90000),
                ),
            )
            pass1_text = pass1_response.text.strip()

            # Parse Pass 1
            try:
                clean_p1 = pass1_text.replace("```json", "").replace("```", "").strip()
                pass1_data = json.loads(clean_p1)
            except Exception:
                pass1_data = None

            # Save Pass 1 output to clips
            try:
                supabase.table("clips").update(
                    {"pass_1_output": pass1_data if pass1_data else {"raw": pass1_text}}
                ).eq("id", clip_id).execute()
            except Exception:
                pass

            # --- Quality gate ---
            if pass1_data and should_skip_pass2(pass1_data):
                print(f"[SKIP] Clip {clip_id} — insufficient footage, Pass 2 skipped")
                supabase.table("clips").update({
                    "status": "complete",
                    "analysis_output": None,
                    "error_message": None,
                }).eq("id", clip_id).execute()
                return

            # --- Multi-query RAG: one search per tactical theme ---
            knowledge_context = ""
            try:
                kb_category = clip_tag.replace("opp_", "") if clip_tag.startswith("opp_") else clip_tag
                if pass1_data:
                    themes_list = aggregate_session_themes([pass1_data])
                else:
                    themes_list = []
                if themes_list:
                    knowledge_context = multi_query_rag(themes_list, category=kb_category)
                elif pass1_text:
                    # Fallback: single search on raw text excerpt
                    fallback_chunks = semantic_search(pass1_text[:500], category=kb_category)
                    knowledge_context = "\n\n---\n\n".join(
                        clean_chunk(c.get("content", "")) for c in fallback_chunks if c.get("content")
                    )
            except Exception:
                pass

            # --- Pass 2: Claude ---
            pass2_prompt = assemble_pass2_prompt(
                knowledge_context, coach_profile, pass1_data, pass1_text, instructions,
                phase=clip_phase, field_zone=clip_field_zone,
            )
            analysis_text = call_claude(pass2_prompt)

        finally:
            os.unlink(tmp_path)

        # Update clip record: complete
        supabase.table("clips").update({
            "status": "complete",
            "analysis_output": analysis_text,
            "error_message": None,
        }).eq("id", clip_id).execute()

    except Exception as e:
        print(f"[BG] FAILED — clip_id={clip_id} error={str(e)}")
        try:
            supabase.table("clips").update({"status": "failed", "error_message": str(e)[:500]}).eq("id", clip_id).execute()
        except Exception as db_err:
            print(f"[BG] Could not update failed status — {db_err}")


def two_pass_analysis_generator(tmp_path: str, clip_id: str, clip_tag: str):
    """Full two-pass flow: Gemini video → semantic search → Claude text."""
    # Fetch clip metadata and coach profile
    clip_phase = ""
    clip_field_zone = ""
    coach_profile = ""
    try:
        clip_row = supabase.table("clips").select("user_id, phase, field_zone").eq("id", clip_id).single().execute()
        clip_user_id = clip_row.data.get("user_id") if clip_row.data else None
        clip_phase = clip_row.data.get("phase") or "" if clip_row.data else ""
        clip_field_zone = clip_row.data.get("field_zone") or "" if clip_row.data else ""
        if clip_user_id:
            profile_row = supabase.table("team_profiles").select("team_name, coach_philosophy").eq("user_id", clip_user_id).limit(1).execute()
            if profile_row.data:
                p = profile_row.data[0]
                profile_parts = []
                if p.get("team_name"):
                    profile_parts.append(f"Team: {p['team_name']}")
                if p.get("coach_philosophy"):
                    profile_parts.append(p["coach_philosophy"])
                coach_profile = "\n".join(profile_parts)
    except Exception:
        coach_profile = ""

    if clip_tag == "attack":
        instructions = ATTACK_INSTRUCTIONS
        pass1_template = PASS1_ATTACK_TEMPLATE
    elif clip_tag == "defence":
        instructions = DEFENCE_INSTRUCTIONS
        pass1_template = PASS1_DEFENCE_TEMPLATE
    elif clip_tag == "opp_attack":
        instructions = OPP_ATTACK_INSTRUCTIONS
        pass1_template = PASS1_OPP_ATTACK_TEMPLATE
    else:  # opp_defence
        instructions = OPP_DEFENCE_INSTRUCTIONS
        pass1_template = PASS1_OPP_DEFENCE_TEMPLATE

    pass1_prompt = build_pass1_prompt(pass1_template, clip_phase, clip_field_zone, coach_profile)

    # --- Pass 1: Gemini video analysis ---
    yield f"data: {json.dumps({'status': 'Uploading to Gemini…'})}\n\n"

    try:
        video_file = gemini.files.upload(
            file=tmp_path,
            config=types.UploadFileConfig(mime_type="video/mp4"),
        )

        yield f"data: {json.dumps({'status': 'Processing video…'})}\n\n"

        while video_file.state.name == "PROCESSING":
            time.sleep(3)
            video_file = gemini.files.get(name=video_file.name)

        if video_file.state.name == "FAILED":
            yield f"data: {json.dumps({'error': 'Gemini video processing failed'})}\n\n"
            return

        yield f"data: {json.dumps({'status': 'Analysing video…'})}\n\n"

        pass1_response = gemini.models.generate_content(
            model="gemini-2.5-pro",
            contents=[
                types.Part.from_uri(file_uri=video_file.uri, mime_type="video/mp4"),
                pass1_prompt,
            ],
            config=types.GenerateContentConfig(
                http_options=types.HttpOptions(timeout=90000),  # 90s timeout — prevents silent hang
            ),
        )
        pass1_text = pass1_response.text.strip()

    except Exception as e:
        yield f"data: {json.dumps({'error': f'Pass 1 failed: {str(e)}'})}\n\n"
        return

    # Parse Pass 1 JSON
    pass1_data = None
    try:
        clean = pass1_text.replace("```json", "").replace("```", "").strip()
        pass1_data = json.loads(clean)
    except Exception:
        pass  # Fall back to raw text for semantic search query

    # Save Pass 1 output
    try:
        supabase.table("clips").update(
            {"pass_1_output": pass1_data if pass1_data is not None else {"raw": pass1_text}}
        ).eq("id", clip_id).execute()
    except Exception:
        pass

    # --- Quality gate ---
    if pass1_data and should_skip_pass2(pass1_data):
        print(f"[SKIP] Clip {clip_id} — insufficient footage, Pass 2 skipped")
        yield f"data: {json.dumps({'status': 'Insufficient footage — skipping analysis'})}\n\n"
        try:
            supabase.table("clips").update({
                "status": "complete",
                "analysis_output": None,
                "error_message": None,
            }).eq("id", clip_id).execute()
        except Exception:
            pass
        return

    # --- Multi-query RAG: one search per tactical theme ---
    yield f"data: {json.dumps({'status': 'Searching knowledge base…'})}\n\n"

    knowledge_context = ""
    try:
        kb_category = clip_tag.replace("opp_", "") if clip_tag.startswith("opp_") else clip_tag
        if pass1_data:
            themes_list = aggregate_session_themes([pass1_data])
        else:
            themes_list = []
        if themes_list:
            knowledge_context = multi_query_rag(themes_list, category=kb_category)
        elif pass1_text:
            fallback_chunks = semantic_search(pass1_text[:500], category=kb_category)
            knowledge_context = "\n\n---\n\n".join(
                clean_chunk(c.get("content", "")) for c in fallback_chunks if c.get("content")
            )
    except Exception:
        pass

    # --- Pass 2: Claude structured analysis ---
    yield f"data: {json.dumps({'status': 'Generating coaching insights…'})}\n\n"

    pass2_prompt = assemble_pass2_prompt(
        knowledge_context, coach_profile, pass1_data, pass1_text, instructions,
        phase=clip_phase, field_zone=clip_field_zone,
    )

    try:
        analysis_text = call_claude(pass2_prompt)
    except Exception as e:
        yield f"data: {json.dumps({'error': f'Pass 2 failed: {str(e)}'})}\n\n"
        return

    # Stream final text in chunks so the frontend accumulator works as before
    chunk_size = 80
    for i in range(0, len(analysis_text), chunk_size):
        yield f"data: {json.dumps({'chunk': analysis_text[i:i+chunk_size]})}\n\n"

    # Save final analysis output
    try:
        supabase.table("clips").update(
            {"analysis_output": analysis_text}
        ).eq("id", clip_id).execute()
    except Exception:
        pass


# --- Shared helpers ---

def fetch_knowledge_base(category: str) -> str:
    response = supabase.table("rugby_knowledge").select(
        "report_title, section_heading, content"
    ).eq("category", category).execute()
    chunks = response.data
    parts = []
    for chunk in chunks:
        cleaned = clean_chunk(chunk.get('content', ''))
        if cleaned:
            parts.append(cleaned)
    return "\n\n---\n\n".join(parts)


def assemble_prompt(coach_profile: str, knowledge_base: str, instructions: str) -> str:
    return f"""
COACH PROFILE
=============
{coach_profile}

RUGBY COACHING KNOWLEDGE
========================
Use this knowledge to inform your analysis but do not reference, cite, quote, or mention any document names, section headers, or source frameworks. The knowledge should shape your output invisibly — never surface it.

{knowledge_base}

ANALYSIS INSTRUCTIONS
=====================
{instructions}
""".strip()


# --- Fix 3: Streaming analysis generator ---
# Flash is used here for speed on single clip analysis.
# Pro is reserved for session-level synthesis across multiple clips.

def stream_analysis(video_path: str, coach_profile: str, instructions: str, category: str):
    knowledge_base = fetch_knowledge_base(category)
    prompt = assemble_prompt(coach_profile, knowledge_base, instructions)

    yield f"data: {json.dumps({'status': 'Uploading to Gemini…'})}\n\n"

    video_file = gemini.files.upload(
        file=video_path,
        config=types.UploadFileConfig(mime_type="video/mp4"),
    )

    yield f"data: {json.dumps({'status': 'Processing video…'})}\n\n"

    while video_file.state.name == "PROCESSING":
        time.sleep(3)
        video_file = gemini.files.get(name=video_file.name)

    if video_file.state.name == "FAILED":
        yield f"data: {json.dumps({'error': 'Gemini video processing failed'})}\n\n"
        return

    yield f"data: {json.dumps({'status': 'Generating analysis…'})}\n\n"

    for chunk in gemini.models.generate_content_stream(
        model="gemini-2.5-pro",
        contents=[
            types.Part.from_uri(file_uri=video_file.uri, mime_type="video/mp4"),
            prompt,
        ],
    ):
        if chunk.text:
            yield f"data: {json.dumps({'chunk': chunk.text})}\n\n"


# --- Request models ---

class SaveClipRequest(BaseModel):
    match_path: str
    start_time: float
    end_time: float
    tag: str
    label: str = ""
    phase: str = ""
    field_zone: str = ""


class AnalyseClipRequest(BaseModel):
    clip_id: str   # Supabase clips table record ID
    clip_path: str  # Supabase storage path


class AnalyseClipBgRequest(BaseModel):
    clip_id: str
    clip_path: str


class CreateMatchRequest(BaseModel):
    name: str        # Must be unique
    date: str        # ISO date string e.g. "2025-03-15"
    match_type: str = "match"  # "match" or "opponent"


class UpdateClipRequest(BaseModel):
    match_id: Optional[str] = None         # None = unlink from match
    label: Optional[str] = None            # None = clear label
    phase: Optional[str] = None
    field_zone: Optional[str] = None
    analysis_output: Optional[str] = None  # Coach-edited analysis text
    excluded: Optional[bool] = None        # Exclude from report generation


# --- Endpoints ---

@app.get("/health")
def health():
    return {"status": "ok"}


# --- Match endpoints ---

@app.get("/matches")
def get_matches(request: Request):
    user_id = get_user_id(request)
    response = (
        supabase.table("matches").select("*")
        .eq("user_id", user_id)
        .eq("match_type", "match")
        .order("date", desc=True)
        .execute()
    )
    return response.data


@app.post("/matches")
def create_match(req: CreateMatchRequest, request: Request):
    user_id = get_user_id(request)
    name = req.name.strip()
    match_type = req.match_type if req.match_type in ("match", "opponent") else "match"
    if not name:
        raise HTTPException(status_code=400, detail="Match name cannot be empty")
    if not req.date:
        raise HTTPException(status_code=400, detail="Match date cannot be empty")

    # Enforce unique name+date per user per type
    existing = (
        supabase.table("matches").select("id")
        .eq("name", name).eq("date", req.date).eq("user_id", user_id).eq("match_type", match_type)
        .execute()
    )
    if existing.data:
        noun = "opponent" if match_type == "opponent" else "match"
        raise HTTPException(status_code=409, detail=f"A {noun} named '{name}' on that date already exists")

    try:
        record = supabase.table("matches").insert({
            "name": name,
            "date": req.date,
            "user_id": user_id,
            "match_type": match_type,
        }).execute()
    except Exception as e:
        if "23505" in str(e) or "duplicate key" in str(e).lower():
            noun = "opponent" if match_type == "opponent" else "match"
            raise HTTPException(status_code=409, detail=f"A {noun} named '{name}' on that date already exists")
        raise

    return record.data[0]


@app.delete("/matches/{match_id}")
def delete_match(match_id: str, request: Request):
    """Delete a match or opponent; associated clips become untagged."""
    user_id = get_user_id(request)
    # Detach clips from this match (only this user's clips)
    supabase.table("clips").update({"match_id": None}).eq("match_id", match_id).eq("user_id", user_id).execute()
    # Delete the record (only if it belongs to this user)
    result = supabase.table("matches").delete().eq("id", match_id).eq("user_id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Match not found")
    return {"deleted": match_id}


# --- Opponent endpoints ---

@app.get("/opponents")
def get_opponents(request: Request):
    user_id = get_user_id(request)
    response = (
        supabase.table("matches").select("*")
        .eq("user_id", user_id)
        .eq("match_type", "opponent")
        .order("date", desc=True)
        .execute()
    )
    return response.data


@app.post("/analyse/attack")
async def analyse_attack(file: UploadFile = File(...)):
    if not file.filename.endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Only .mp4 files are supported")

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    def generate():
        try:
            yield from stream_analysis(tmp_path, ATTACK_COACH_PROFILE, ATTACK_INSTRUCTIONS, "attack")
        finally:
            os.unlink(tmp_path)

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/analyse/defence")
async def analyse_defence(file: UploadFile = File(...)):
    if not file.filename.endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Only .mp4 files are supported")

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    def generate():
        try:
            yield from stream_analysis(tmp_path, DEFENCE_COACH_PROFILE, DEFENCE_INSTRUCTIONS, "defence")
        finally:
            os.unlink(tmp_path)

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/upload/match")
async def upload_match(file: UploadFile = File(...)):
    if not file.filename.endswith((".mp4", ".mov")):
        raise HTTPException(status_code=400, detail="Only .mp4 and .mov files are supported")

    data = await file.read()
    safe_filename = os.path.basename(file.filename)
    storage_path = f"matches/{safe_filename}"

    # Fix 2: Save local temp copy so clip cutting doesn't need to re-download
    local_path = os.path.join(TEMP_DIR, safe_filename)
    with open(local_path, "wb") as f:
        f.write(data)
    temp_videos[storage_path] = local_path

    supabase.storage.from_("match-clips").upload(
        path=storage_path,
        file=data,
        file_options={"content-type": file.content_type or "video/mp4", "upsert": "true"},
    )

    public_url = supabase.storage.from_("match-clips").get_public_url(storage_path)

    return {"storage_path": storage_path, "public_url": public_url}


@app.post("/clips/save")
async def save_clip(req: SaveClipRequest):
    if req.tag not in ("attack", "defence"):
        raise HTTPException(status_code=400, detail="tag must be 'attack' or 'defence'")
    if req.end_time <= req.start_time:
        raise HTTPException(status_code=400, detail="end_time must be greater than start_time")

    # Fix 2: Use local temp file if available, fall back to Supabase download
    local_match = temp_videos.get(req.match_path)
    if local_match and os.path.exists(local_match):
        src_path = local_match
        cleanup_src = False
    else:
        video_bytes = supabase.storage.from_("match-clips").download(req.match_path)
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as src_tmp:
            src_tmp.write(video_bytes)
            src_path = src_tmp.name
        cleanup_src = True

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    clip_filename = f"{timestamp}_{req.tag}.mp4"
    clip_storage_path = f"clips/{clip_filename}"

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as dst_tmp:
        dst_path = dst_tmp.name

    try:
        duration = req.end_time - req.start_time
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", str(req.start_time),
                "-i", src_path,
                "-t", str(duration),
                "-c", "copy",
                dst_path,
            ],
            capture_output=True,
            text=True,
        )

        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"FFmpeg error: {result.stderr}")

        with open(dst_path, "rb") as f:
            clip_bytes = f.read()

        supabase.storage.from_("match-clips").upload(
            path=clip_storage_path,
            file=clip_bytes,
            file_options={"content-type": "video/mp4", "upsert": "true"},
        )

        clip_url = supabase.storage.from_("match-clips").get_public_url(clip_storage_path)

        record = supabase.table("clips").insert({
            "match_path": req.match_path,
            "clip_path": clip_storage_path,
            "clip_url": clip_url,
            "start_time": req.start_time,
            "end_time": req.end_time,
            "tag": req.tag,
            "label": req.label or None,
        }).execute()

        return record.data[0]

    finally:
        if cleanup_src:
            os.unlink(src_path)
        os.unlink(dst_path)


@app.post("/clips/upload-direct")
async def upload_clip_direct(
    request: Request,
    file: UploadFile = File(...),
    start_time: float = Form(...),
    end_time: float = Form(...),
    tag: str = Form(...),
    label: str = Form(""),
    match_id: str = Form(""),
    phase: str = Form(""),
    field_zone: str = Form(""),
):
    """Receive a pre-trimmed clip blob from the browser (no full match upload needed)."""
    user_id = get_user_id(request)

    if tag not in ("attack", "defence", "opp_attack", "opp_defence"):
        raise HTTPException(status_code=400, detail="tag must be 'attack', 'defence', 'opp_attack', or 'opp_defence'")
    if end_time <= start_time:
        raise HTTPException(status_code=400, detail="end_time must be greater than start_time")

    data = await file.read()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    # Preserve the actual extension (webm from MediaRecorder, mp4 from legacy)
    raw_ext = (file.filename or "clip.webm").rsplit(".", 1)[-1].lower()
    ext = raw_ext if raw_ext in ("mp4", "webm", "mov") else "webm"
    clip_filename = f"{timestamp}_{tag}.{ext}"
    clip_storage_path = f"clips/{clip_filename}"

    supabase.storage.from_("match-clips").upload(
        path=clip_storage_path,
        file=data,
        file_options={"content-type": "video/mp4", "upsert": "true"},
    )

    clip_url = supabase.storage.from_("match-clips").get_public_url(clip_storage_path)

    record = supabase.table("clips").insert({
        "match_path": "local",
        "clip_path": clip_storage_path,
        "clip_url": clip_url,
        "start_time": start_time,
        "end_time": end_time,
        "tag": tag,
        "label": label or None,
        "match_id": match_id or None,
        "phase": phase or None,
        "field_zone": field_zone or None,
        "status": "pending",
        "user_id": user_id,
    }).execute()

    return record.data[0]


@app.get("/clips")
def get_clips(request: Request, match_id: Optional[str] = None):
    user_id = get_user_id(request)
    query = supabase.table("clips").select("*").eq("user_id", user_id).order("created_at", desc=True)
    if match_id:
        query = query.eq("match_id", match_id)
    response = query.execute()
    return response.data


@app.get("/clips/{clip_id}")
def get_clip(clip_id: str, request: Request):
    user_id = get_user_id(request)
    response = supabase.table("clips").select("*").eq("id", clip_id).eq("user_id", user_id).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Clip not found")
    return response.data[0]


@app.patch("/clips/{clip_id}")
def update_clip(clip_id: str, req: UpdateClipRequest, request: Request):
    """Update a clip's match association, label, analysis output, or excluded state."""
    user_id = get_user_id(request)
    update_data: dict = {}
    if req.match_id is not None or "match_id" in req.model_fields_set:
        update_data["match_id"] = req.match_id or None
    if req.label is not None or "label" in req.model_fields_set:
        update_data["label"] = req.label.strip() if req.label and req.label.strip() else None
    if req.phase is not None or "phase" in req.model_fields_set:
        update_data["phase"] = req.phase or None
    if req.field_zone is not None or "field_zone" in req.model_fields_set:
        update_data["field_zone"] = req.field_zone or None
    if req.analysis_output is not None:
        update_data["analysis_output"] = req.analysis_output
    if req.excluded is not None:
        update_data["excluded"] = req.excluded
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    response = supabase.table("clips").update(update_data).eq("id", clip_id).eq("user_id", user_id).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Clip not found")
    return response.data[0]


@app.delete("/clips/{clip_id}")
def delete_clip(clip_id: str, request: Request):
    """Delete a clip, its analyses, and its storage file."""
    user_id = get_user_id(request)
    # Fetch the clip to get its storage path (verify ownership)
    clip_res = supabase.table("clips").select("clip_path").eq("id", clip_id).eq("user_id", user_id).execute()
    if not clip_res.data:
        raise HTTPException(status_code=404, detail="Clip not found")

    clip_path = clip_res.data[0].get("clip_path")

    # Delete associated analyses if the table exists (best-effort)
    try:
        supabase.table("clip_analyses").delete().eq("clip_id", clip_id).execute()
    except Exception:
        pass

    # Delete the clip record
    supabase.table("clips").delete().eq("id", clip_id).execute()

    # Delete from storage (best-effort — don't fail if file is missing)
    if clip_path and clip_path != "local":
        try:
            supabase.storage.from_("match-clips").remove([clip_path])
        except Exception:
            pass

    return {"deleted": clip_id}


@app.post("/analyse/clip/bg")
def analyse_clip_bg(req: AnalyseClipBgRequest):
    """Queue a clip for background analysis — returns immediately."""
    import threading
    clip_record = supabase.table("clips").select("tag, clip_path").eq("id", req.clip_id).execute()
    if not clip_record.data:
        raise HTTPException(status_code=404, detail="Clip not found")
    clip_tag = clip_record.data[0]["tag"]
    clip_path = req.clip_path or clip_record.data[0].get("clip_path", "")
    print(f"[BG] Queuing analysis — clip_id={req.clip_id} path={clip_path} tag={clip_tag}")
    thread = threading.Thread(
        target=run_full_analysis_bg,
        args=(req.clip_id, clip_path, clip_tag),
        daemon=True,
    )
    thread.start()
    return {"status": "queued", "clip_id": req.clip_id}


@app.post("/analyse/clip")
async def analyse_clip(req: AnalyseClipRequest):
    clip_record = supabase.table("clips").select("tag").eq("id", req.clip_id).execute()
    if not clip_record.data:
        raise HTTPException(status_code=404, detail="Clip not found")
    clip_tag = clip_record.data[0]["tag"]

    if clip_tag not in ("attack", "defence", "opp_attack", "opp_defence"):
        raise HTTPException(status_code=400, detail="Invalid clip tag")

    video_bytes = supabase.storage.from_("match-clips").download(req.clip_path)

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name

    def generate():
        try:
            yield from two_pass_analysis_generator(tmp_path, req.clip_id, clip_tag)
        finally:
            os.unlink(tmp_path)

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.delete("/temp/{filename}")
def delete_temp(filename: str):
    """Delete a cached temp match file when a session is done."""
    local_path = os.path.join(TEMP_DIR, filename)
    storage_path = f"matches/{filename}"

    if storage_path in temp_videos:
        del temp_videos[storage_path]

    if os.path.exists(local_path):
        os.unlink(local_path)
        return {"deleted": filename}

    return {"status": "not_found"}


# ── Automated analysis pipeline ────────────────────────────────────────────────

@app.post("/auto-analysis/start")
async def start_auto_analysis(
    request: Request,
    video: UploadFile = File(...),
    our_colour: str = Form(...),
    opp_colour: str = Form(...),
    match_id: str = Form(...),
):
    user_id = get_user_id(request)

    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not configured")

    job_id = str(uuid.uuid4())

    # Save video to a temp file that the pipeline thread will own and delete
    suffix = ".mp4"
    if video.filename and video.filename.lower().endswith(".mov"):
        suffix = ".mov"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False, dir=TEMP_DIR)
    tmp.write(await video.read())
    tmp.close()

    auto_jobs[job_id] = {
        "job_id": job_id,
        "status": "running",
        "current_step": 1,
        "step_name": "Initialising",
        "current_chunk": 0,
        "total_chunks": 0,
        "clips_detected": 0,
        "clips_kept": 0,
        "failed_chunks": [],
        "error": None,
        "attack_report": None,
        "defence_report": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    thread = threading.Thread(
        target=run_automated_pipeline,
        args=(
            job_id, tmp.name, our_colour, opp_colour, match_id, user_id,
            gemini, ANTHROPIC_API_KEY, supabase, embed_query,
        ),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id}


@app.get("/auto-analysis/{job_id}")
def get_auto_analysis_status(job_id: str, request: Request):
    get_user_id(request)  # auth check
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
