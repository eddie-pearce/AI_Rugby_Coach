import os
import sys
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

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))

if len(sys.argv) < 2:
    raise SystemExit("Usage: python analyse_defence_clip.py <filename.mp4>")

VIDEO_PATH = os.path.join(PROJECT_ROOT, sys.argv[1])

# --- Coach Profile ---
COACH_PROFILE = """
Team: Test RFC
Level: Semi-Professional
Attack Philosophy: Expansive, wide attacking rugby with emphasis on offloading and creating overlaps. Move the ball wide quickly and exploit space in wide channels.
Key Principles: Width and tempo, offload in contact, quick ball from breakdown, exploit mismatches in wide channels.
Defence System: Blitz defence.
Defensive Principles: High line speed, press early, force errors, aggressive in the collision, hunt turnovers at the breakdown.
""".strip()

# --- Analysis Instructions ---
ANALYSIS_INSTRUCTIONS = """
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


# --- Step 1: Fetch defence chunks from Supabase ---
print("Step 1: Fetching defence chunks from Supabase...")
response = supabase.table("rugby_knowledge").select(
    "report_title, section_heading, content"
).eq("category", "defence").execute()
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
print(f"DEFENCE ANALYSIS — {sys.argv[1]}")
print("=" * 60)
print(response.text)
