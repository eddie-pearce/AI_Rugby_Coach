import os
import time

from dotenv import load_dotenv
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

import sys

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))

if len(sys.argv) < 2:
    raise SystemExit("Usage: python analyse_clip.py <filename.mp4>")

VIDEO_PATH = os.path.join(PROJECT_ROOT, sys.argv[1])

# --- Coach Profile ---
COACH_PROFILE = """
Team: Test RFC
Level: Semi-Professional
Attack Philosophy: Expansive, wide attacking rugby with emphasis on offloading and creating overlaps. Move the ball wide quickly and exploit space in wide channels.
Key Principles: Width and tempo, offload in contact, quick ball from breakdown, exploit mismatches in wide channels.
""".strip()

# --- Analysis Instructions ---
ANALYSIS_INSTRUCTIONS = """
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


# --- Step 1: Fetch attack chunks from Supabase ---
print("Step 1: Fetching attack chunks from Supabase...")
response = supabase.table("rugby_knowledge").select(
    "report_title, section_heading, content"
).eq("category", "attack").execute()
chunks = response.data
print(f"  Retrieved {len(chunks)} chunks.\n")


# --- Step 2: Format knowledge base ---
print("Step 2: Formatting knowledge base...")
knowledge_parts = []
for chunk in chunks:
    header = f"## {chunk['report_title']} — {chunk['section_heading']}"
    knowledge_parts.append(f"{header}\n{chunk['content']}")
knowledge_base = "\n\n---\n\n".join(knowledge_parts)
print(f"  Knowledge base formatted ({len(knowledge_base):,} characters).\n")


# --- Step 3: Assemble prompt ---
print("Step 3: Assembling prompt...")
prompt = f"""
COACH PROFILE
=============
{COACH_PROFILE}

RUGBY KNOWLEDGE BASE
====================
{knowledge_base}

ANALYSIS INSTRUCTIONS
=====================
{ANALYSIS_INSTRUCTIONS}
""".strip()
print(f"  Prompt assembled ({len(prompt):,} characters).\n")


# --- Step 4: Upload video via Gemini Files API ---
print("Step 4: Uploading video to Gemini Files API...")
if not os.path.exists(VIDEO_PATH):
    raise FileNotFoundError(f"Video file not found: {VIDEO_PATH}")

video_file = gemini.files.upload(
    file=VIDEO_PATH,
    config=types.UploadFileConfig(mime_type="video/mp4"),
)
print(f"  Uploaded: {video_file.name} (state: {video_file.state.name})")

print("  Waiting for Gemini to process video", end="", flush=True)
while video_file.state.name == "PROCESSING":
    print(".", end="", flush=True)
    time.sleep(3)
    video_file = gemini.files.get(name=video_file.name)

if video_file.state.name == "FAILED":
    raise RuntimeError(f"Video processing failed: {video_file.state}")

print(f"\n  Video ready (state: {video_file.state.name}).\n")


# --- Step 5: Send to Gemini 2.5 Pro ---
print("Step 5: Sending to Gemini 2.5 Pro for analysis...")
response = gemini.models.generate_content(
    model="gemini-2.5-pro",
    contents=[
        types.Part.from_uri(file_uri=video_file.uri, mime_type="video/mp4"),
        prompt,
    ],
)
print("  Response received.\n")


# --- Step 6: Print full analysis ---
print("=" * 60)
print(f"ATTACK ANALYSIS — {sys.argv[1]}")
print("=" * 60)
print(response.text)
