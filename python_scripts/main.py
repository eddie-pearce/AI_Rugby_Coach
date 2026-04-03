import os
import time
import tempfile

from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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


# --- Shared analysis logic ---

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


def run_analysis(video_path: str, coach_profile: str, instructions: str, category: str) -> str:
    knowledge_base = fetch_knowledge_base(category)

    prompt = f"""
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

    video_file = gemini.files.upload(
        file=video_path,
        config=types.UploadFileConfig(mime_type="video/mp4"),
    )

    while video_file.state.name == "PROCESSING":
        time.sleep(3)
        video_file = gemini.files.get(name=video_file.name)

    if video_file.state.name == "FAILED":
        raise RuntimeError(f"Gemini video processing failed: {video_file.state}")

    response = gemini.models.generate_content(
        model="gemini-2.5-pro",
        contents=[
            types.Part.from_uri(file_uri=video_file.uri, mime_type="video/mp4"),
            prompt,
        ],
    )

    return response.text


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

    try:
        analysis = run_analysis(tmp_path, ATTACK_COACH_PROFILE, ATTACK_INSTRUCTIONS, "attack")
    finally:
        os.unlink(tmp_path)

    return {"status": "success", "analysis": analysis, "type": "attack"}


@app.post("/analyse/defence")
async def analyse_defence(file: UploadFile = File(...)):
    if not file.filename.endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Only .mp4 files are supported")

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        analysis = run_analysis(tmp_path, DEFENCE_COACH_PROFILE, DEFENCE_INSTRUCTIONS, "defence")
    finally:
        os.unlink(tmp_path)

    return {"status": "success", "analysis": analysis, "type": "defence"}
