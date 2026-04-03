import os
import time
import tempfile
import subprocess
import json
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from google import genai
from google.genai import types
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

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
You are an experienced rugby union attack coach. Use the rugby knowledge base provided to inform your analysis. Tailor all feedback to the coach's attacking philosophy outlined above.

Analyse the entire attacking sequence from first possession to last. Focus on the full journey of the attack — the structure, movement, decisions, and execution throughout every phase, not just the decisive moment or end result.

Important rules before you begin:
- Never refer to a player by their number or position. Always refer to them as "the player", "the ball carrier", "the support runner" etc
- Do not reference timestamps
- Do not focus on the end result — analyse the full sequence
- Every observation must be grounded in what you actually see in the footage
- Be direct and specific — no padding, no fluff, no corporate language
- Prioritise your strongest, most confident observations only

Return exactly this structure and nothing else:

WHAT THEY TRIED TO DO
2-3 sentences describing the intent and structure of the attacking sequence. What was the team trying to achieve and how did they try to achieve it?

WHAT WORKED
Between 1 and 4 bullet points. One sentence each. Only include genuine observations of things the attack executed well — do not pad or reach for positives that aren't there. If the attacking sequence was poor with little to praise, write one brief sentence acknowledging this instead of forcing bullet points. Every point must be grounded in something you actually saw.

WHAT DIDN'T WORK
Between 1 and 4 bullet points. One sentence each. Only include genuine observations of things that broke down in the attacking structure, decision making, or execution. Do not reach for problems that don't exist. If the attacking sequence was excellent with little to improve, write one brief sentence acknowledging this instead of forcing bullet points. Focus on the play itself — not the consequence or what should happen next.

The number of points in each section should honestly reflect the quality of the attacking sequence. A brilliant try should have more positives than work ons. A poor attacking sequence should have more work ons than positives. Never manufacture observations to fill a quota.

COACHING CUE
One single sentence. The most important thing this team should take into training this week based on this clip.
""".strip()

DEFENCE_INSTRUCTIONS = """
You are an experienced rugby union defence coach. Use the rugby knowledge base provided to inform your analysis. Tailor all feedback to the coach's defensive philosophy outlined above.

Analyse the entire defensive sequence from the moment the opposition gains possession to the end of the sequence. Do not focus only on the moment the line break or score occurs — analyse the full defensive journey. Break down every phase: how the defence was organised, the line speed, the alignment, the decision making, the tackle attempts, the breakdown work, and where the defence held firm or where it was exposed.

Important rules before you begin:
- Never refer to a player by their number or position. Always refer to them as "the defender", "the tackler", "the blitzer" etc
- Do not reference timestamps
- Do not focus only on the moment of failure — analyse the full defensive sequence
- Every observation must be grounded in what you actually see in the footage
- Be direct and specific — no padding, no fluff, no corporate language
- Prioritise your strongest, most confident observations only

Return exactly this structure and nothing else:

WHAT THEY TRIED TO DO DEFENSIVELY
2-3 sentences describing the defensive system and intent. What was the defence trying to achieve and how did they set up to achieve it?

WHAT WORKED
Between 1 and 4 bullet points. One sentence each. Only include genuine observations of things the defence executed well. Do not pad or reach for positives that aren't there. If the defensive sequence was poor with little to praise, write one brief sentence acknowledging this instead of forcing bullet points.

WHAT DIDN'T WORK
Between 1 and 4 bullet points. One sentence each. Only include genuine observations of what broke down in the defensive structure, organisation, decision making, or execution. Do not reach for problems that don't exist. If the defence was excellent, write one brief sentence acknowledging this instead of forcing bullet points. Focus on the sequence itself — not the consequence.

COACHING CUE
One single sentence. The most important defensive thing this team should take into training this week based on this clip.

The number of points in each section should honestly reflect the quality of the defensive sequence. A dominant defensive display should have more positives than work ons. A poor defensive sequence that conceded a line break should have more work ons than positives. Never manufacture observations to fill a quota.
""".strip()


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

    # Fix 4: gemini-2.0-flash for speed on clip analysis (Pro reserved for session synthesis)
    for chunk in gemini.models.generate_content_stream(
        model="gemini-2.0-flash",
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


# --- Endpoints ---

@app.get("/health")
def health():
    return {"status": "ok"}


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


@app.get("/clips")
def get_clips():
    response = supabase.table("clips").select("*").order("created_at", desc=True).execute()
    return response.data


@app.get("/clips/{clip_id}")
def get_clip(clip_id: str):
    response = supabase.table("clips").select("*").eq("id", clip_id).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Clip not found")
    return response.data[0]


@app.post("/analyse/clip")
async def analyse_clip(req: AnalyseClipRequest):
    # Look up the clip tag from the DB to determine which profile/instructions to use
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

    coach_profile = ATTACK_COACH_PROFILE if clip_tag == "attack" else DEFENCE_COACH_PROFILE
    instructions = ATTACK_INSTRUCTIONS if clip_tag == "attack" else DEFENCE_INSTRUCTIONS

    def generate():
        full_text: list[str] = []
        try:
            for event in stream_analysis(tmp_path, coach_profile, instructions, clip_tag):
                # Accumulate chunk text so we can save it after streaming completes
                if event.startswith("data: "):
                    try:
                        payload = json.loads(event[6:].strip())
                        if "chunk" in payload:
                            full_text.append(payload["chunk"])
                    except Exception:
                        pass
                yield event
        finally:
            os.unlink(tmp_path)
            # Save the full analysis output to the clips record
            if full_text:
                try:
                    supabase.table("clips").update(
                        {"analysis_output": "".join(full_text)}
                    ).eq("id", req.clip_id).execute()
                except Exception:
                    pass  # Don't fail the response if the DB save fails

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
