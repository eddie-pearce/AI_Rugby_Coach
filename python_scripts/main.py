import os
import time
import tempfile
import subprocess
import json
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
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
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
Attack Philosophy: Expansive, wide attacking rugby with emphasis on offloading and creating overlaps. Move the ball wide quickly and exploit space in wide channels.
Key Principles: Width and tempo, offload in contact, quick ball from breakdown, exploit mismatches in wide channels.
Defence System: Blitz defence.
Defensive Principles: High line speed, press early, force errors, aggressive in the collision, hunt turnovers at the breakdown.
""".strip()

# --- Analysis instructions ---

ATTACK_INSTRUCTIONS = """
You are an elite rugby union attack coach with deep tactical knowledge. Use the coach's philosophy as context only — do not penalise good execution simply because it differs from the preferred system. If the team executed well and scored, reflect that honestly. The philosophy is a lens, not a rulebook.

Analyse the attacking sequence. Report only what you can clearly see. If uncertain, leave it out.

Rules:
- Never refer to players by number or position — use "the ball carrier", "the support runner", "the first receiver" etc
- Do not reference timestamps
- Analyse the sequence, not the end result
- Use precise rugby terminology throughout — name the structures, plays, and tactical concepts you observe (e.g. pod system, strike play from ruck, wide channel overload, short-side attack, blitz exploit, offload in the tackle, gate attack, crash ball)
- Every bullet point must be one tight sentence — no padding, no scene-setting, no restating the obvious
- Only include observations you are fully confident in

Return exactly this structure, nothing else:

INTENT
One sentence maximum. Name the attacking structure or play being executed and what it was designed to achieve.

WHAT WORKED
Maximum 3 bullet points. Each bullet is one short punchy clause — 15 words maximum. Name the tactical concept and what made it effective. No subordinate clauses, no consequences, no explanation of why it matters. Just the observation.
Example of the right length and style: "Quick ruck ball allowed the attack to hit the blitz line before it was set."
If there are only 1 or 2 genuine observations, write only those. If nothing worked, write: "Nothing significant to note."

WHAT DIDN'T WORK
Maximum 3 bullet points. Each bullet is one short punchy clause — 15 words maximum. Name the tactical breakdown specifically. No subordinate clauses, no consequences, no explanation of why it matters. Just the observation.
Example of the right length and style: "The pod attack hit a static gain line with no offload option available."
If there are only 1 or 2 genuine observations, write only those. If nothing broke down, write: "Nothing significant to note."

No filler. No waffle. No generic coaching phrases. If the clip is too brief or unclear to analyse, say so in one sentence.
""".strip()

DEFENCE_INSTRUCTIONS = """
You are an elite rugby union defence coach with deep tactical knowledge. Use the coach's philosophy as context only — do not penalise good execution simply because it differs from the preferred system. If the team defended well and held the line, reflect that honestly. The philosophy is a lens, not a rulebook.

Analyse the defensive sequence. Report only what you can clearly see. If uncertain, leave it out.

Rules:
- Never refer to players by number or position — use "the defender", "the tackler", "the blitz line" etc
- Do not reference timestamps
- Analyse the full sequence, not just the moment of failure or success
- Use precise rugby terminology throughout — name the defensive systems, patterns, and tactical concepts you observe (e.g. blitz defence, drift defence, man-on-man, rush defence, pillar and post, line speed, inside shoulder, ruck pressure, choke tackle, turnover hunt)
- Every bullet point must be one tight sentence — no padding, no scene-setting, no restating the obvious
- Only include observations you are fully confident in

Return exactly this structure, nothing else:

DEFENSIVE INTENT
One sentence maximum. Name the defensive system being used and what it was designed to achieve.

WHAT WORKED
Maximum 3 bullet points. Each bullet is one short punchy clause — 15 words maximum. Name the tactical concept and what made it effective. No subordinate clauses, no consequences, no explanation of why it matters. Just the observation.
Example of the right length and style: "High line speed from the blitz compressed the breakdown and forced an early turnover."
If there are only 1 or 2 genuine observations, write only those. If nothing worked, write: "Nothing significant to note."

WHAT DIDN'T WORK
Maximum 3 bullet points. Each bullet is one short punchy clause — 15 words maximum. Name the tactical breakdown specifically. No subordinate clauses, no consequences, no explanation of why it matters. Just the observation.
Example of the right length and style: "Drift defence lost inside shoulder as the attack switched back against the grain."
If there are only 1 or 2 genuine observations, write only those. If nothing broke down, write: "Nothing significant to note."

No filler. No waffle. No generic coaching phrases. If the clip is too brief or unclear to analyse, say so in one sentence.
""".strip()

# --- Pass 1 prompts (Gemini video → JSON) ---

PASS1_ATTACK_PROMPT = """
You are an experienced rugby union attack coach.

Analyse this rugby clip. Identify the key tactical concepts, patterns, and themes present in what you observe. Use specific rugby terminology only — no padding, no filler.

Return ONLY a valid JSON object with this structure, no preamble, no markdown:
{
  "tactical_themes": ["array of specific rugby tactical concepts observed"],
  "patterns_observed": ["array of specific patterns or breakdowns seen"],
  "quality_indicators": "poor, mixed, or good for overall sequence",
  "context": "2-3 sentence summary of what happened in the clip"
}
""".strip()

PASS1_DEFENCE_PROMPT = """
You are an experienced rugby union defence coach.

Analyse this rugby clip. Identify the key tactical concepts, patterns, and themes present in what you observe. Use specific rugby terminology only — no padding, no filler.

Return ONLY a valid JSON object with this structure, no preamble, no markdown:
{
  "tactical_themes": ["array of specific rugby defensive tactical concepts observed"],
  "patterns_observed": ["array of specific patterns or breakdowns seen"],
  "quality_indicators": "poor, mixed, or good for overall sequence",
  "context": "2-3 sentence summary of what happened in the clip"
}
""".strip()


# --- Two-pass helpers ---

def embed_query(query: str) -> list[float]:
    result = gemini.models.embed_content(
        model="models/gemini-embedding-001",
        contents=query,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY"),
    )
    return result.embeddings[0].values


def semantic_search(query: str, category: str, top_k: int = 5) -> list[dict]:
    query_embedding = embed_query(query)
    response = supabase.rpc(
        "match_rugby_knowledge",
        {"query_embedding": query_embedding, "match_count": top_k, "filter_category": category},
    ).execute()
    return response.data or []


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
            "max_tokens": 2048,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=60,
    )
    response.raise_for_status()
    return response.json()["content"][0]["text"]


def assemble_pass2_prompt(
    knowledge_context: str, coach_profile: str, pass1_data: Optional[dict], pass1_raw: str, instructions: str
) -> str:
    parts = []
    if knowledge_context:
        parts.append(f"--- RUGBY KNOWLEDGE BASE ---\n{knowledge_context}")
    if coach_profile:
        parts.append(f"--- COACH PHILOSOPHY ---\n{coach_profile}")

    # Inject Pass 1 video intelligence brief
    if pass1_data:
        clip_lines = []

        if pass1_data.get("context"):
            clip_lines.append(f"CLIP CONTEXT\n{pass1_data['context']}")

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

        # Fetch user's team profile from Supabase
        try:
            clip_row = supabase.table("clips").select("user_id").eq("id", clip_id).single().execute()
            clip_user_id = clip_row.data.get("user_id") if clip_row.data else None
            coach_profile = ""
            if clip_user_id:
                profile_row = supabase.table("team_profiles").select("team_name, coach_philosophy").eq("user_id", clip_user_id).limit(1).execute()
                if profile_row.data:
                    p = profile_row.data[0]
                    parts = []
                    if p.get("team_name"):
                        parts.append(f"Team: {p['team_name']}")
                    if p.get("coach_philosophy"):
                        parts.append(p["coach_philosophy"])
                    coach_profile = "\n".join(parts)
        except Exception:
            coach_profile = ""

        try:
            instructions = ATTACK_INSTRUCTIONS if clip_tag == "attack" else DEFENCE_INSTRUCTIONS
            pass1_prompt = PASS1_ATTACK_PROMPT if clip_tag == "attack" else PASS1_DEFENCE_PROMPT

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
                clean = pass1_text.replace("```json", "").replace("```", "").strip()
                pass1_data = json.loads(clean)
            except Exception:
                pass1_data = None

            # Save Pass 1 output to clips
            try:
                supabase.table("clips").update(
                    {"pass_1_output": pass1_data if pass1_data else {"raw": pass1_text}}
                ).eq("id", clip_id).execute()
            except Exception:
                pass

            # --- Semantic search ---
            knowledge_context = ""
            try:
                if pass1_data:
                    themes = pass1_data.get("tactical_themes", [])
                    patterns = pass1_data.get("patterns_observed", [])
                    query = " ".join(themes + patterns) or pass1_text[:500]
                else:
                    query = pass1_text[:500]

                chunks = semantic_search(query, category=clip_tag, top_k=5)
                kb_parts = []
                for chunk in chunks:
                    header = f"{chunk.get('report_title', '')} — {chunk.get('section_heading', '')}"
                    kb_parts.append(f"{header}\n{chunk.get('content', '')}")
                knowledge_context = "\n\n---\n\n".join(kb_parts)
            except Exception:
                pass

            # --- Pass 2: Claude ---
            pass2_prompt = assemble_pass2_prompt(knowledge_context, coach_profile, pass1_data, pass1_text, instructions)
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
    # Fetch user's team profile
    coach_profile = ""
    try:
        clip_row = supabase.table("clips").select("user_id").eq("id", clip_id).single().execute()
        clip_user_id = clip_row.data.get("user_id") if clip_row.data else None
        if clip_user_id:
            profile_row = supabase.table("team_profiles").select("team_name, coach_philosophy").eq("user_id", clip_user_id).limit(1).execute()
            if profile_row.data:
                p = profile_row.data[0]
                parts = []
                if p.get("team_name"):
                    parts.append(f"Team: {p['team_name']}")
                if p.get("coach_philosophy"):
                    parts.append(p["coach_philosophy"])
                coach_profile = "\n".join(parts)
    except Exception:
        coach_profile = ""

    instructions = ATTACK_INSTRUCTIONS if clip_tag == "attack" else DEFENCE_INSTRUCTIONS
    pass1_prompt = PASS1_ATTACK_PROMPT if clip_tag == "attack" else PASS1_DEFENCE_PROMPT

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

    # --- Semantic search ---
    yield f"data: {json.dumps({'status': 'Searching knowledge base…'})}\n\n"

    knowledge_context = ""
    try:
        if pass1_data:
            themes = pass1_data.get("tactical_themes", [])
            patterns = pass1_data.get("patterns_observed", [])
            structure = pass1_data.get("attacking_structure") or pass1_data.get("defensive_system") or ""
            query = " ".join(themes + patterns + ([structure] if structure else []))
        else:
            query = pass1_text[:500]

        chunks = semantic_search(query, category=clip_tag, top_k=5)
        parts = []
        for chunk in chunks:
            header = f"{chunk.get('report_title', '')} — {chunk.get('section_heading', '')}"
            parts.append(f"{header}\n{chunk.get('content', '')}")
        knowledge_context = "\n\n---\n\n".join(parts)
    except Exception:
        pass  # Proceed without knowledge base rather than failing

    # --- Pass 2: Claude structured analysis ---
    yield f"data: {json.dumps({'status': 'Generating coaching insights…'})}\n\n"

    pass2_prompt = assemble_pass2_prompt(knowledge_context, coach_profile, pass1_data, pass1_text, instructions)

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
        header = f"## {chunk['report_title']} — {chunk['section_heading']}"
        parts.append(f"{header}\n{chunk['content']}")
    return "\n\n---\n\n".join(parts)


def assemble_prompt(coach_profile: str, knowledge_base: str, instructions: str) -> str:
    return f"""
COACH PROFILE
=============
{coach_profile}

RUGBY KNOWLEDGE BASE
====================
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


class AnalyseClipRequest(BaseModel):
    clip_id: str   # Supabase clips table record ID
    clip_path: str  # Supabase storage path


class AnalyseClipBgRequest(BaseModel):
    clip_id: str
    clip_path: str


class CreateMatchRequest(BaseModel):
    name: str        # Must be unique
    date: str        # ISO date string e.g. "2025-03-15"


class UpdateClipRequest(BaseModel):
    match_id: Optional[str] = None   # None = unlink from match
    label: Optional[str] = None      # None = clear label


# --- Endpoints ---

@app.get("/health")
def health():
    return {"status": "ok"}


# --- Match endpoints ---

@app.get("/matches")
def get_matches(request: Request):
    user_id = get_user_id(request)
    response = supabase.table("matches").select("*").eq("user_id", user_id).order("date", desc=True).execute()
    return response.data


@app.post("/matches")
def create_match(req: CreateMatchRequest, request: Request):
    user_id = get_user_id(request)
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Match name cannot be empty")
    if not req.date:
        raise HTTPException(status_code=400, detail="Match date cannot be empty")

    # Enforce unique match name per user
    existing = supabase.table("matches").select("id").eq("name", name).eq("user_id", user_id).execute()
    if existing.data:
        raise HTTPException(status_code=409, detail=f"A match named '{name}' already exists")

    record = supabase.table("matches").insert({
        "name": name,
        "date": req.date,
        "user_id": user_id,
    }).execute()

    return record.data[0]


@app.delete("/matches/{match_id}")
def delete_match(match_id: str, request: Request):
    """Delete a match; associated clips become untagged (match_id set to null)."""
    user_id = get_user_id(request)
    # Detach clips from this match (only this user's clips)
    supabase.table("clips").update({"match_id": None}).eq("match_id", match_id).eq("user_id", user_id).execute()
    # Delete the match record (only if it belongs to this user)
    result = supabase.table("matches").delete().eq("id", match_id).eq("user_id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Match not found")
    return {"deleted": match_id}


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
    match_id: str = Form(""),  # UUID of the selected match (optional)
):
    """Receive a pre-trimmed clip blob from the browser (no full match upload needed)."""
    user_id = get_user_id(request)

    if tag not in ("attack", "defence"):
        raise HTTPException(status_code=400, detail="tag must be 'attack' or 'defence'")
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
    """Update a clip's match association and/or label."""
    user_id = get_user_id(request)
    update_data = {
        "match_id": req.match_id or None,
        "label": req.label.strip() if req.label and req.label.strip() else None,
    }
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

    if clip_tag not in ("attack", "defence"):
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
