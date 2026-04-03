import json
import os

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise EnvironmentError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")

client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

CHUNKS_FILE = os.path.join(os.path.dirname(__file__), "defence_chunks_embedded.json")

with open(CHUNKS_FILE, "r", encoding="utf-8") as f:
    chunks = json.load(f)

total = len(chunks)
success = 0
failed = 0

for i, chunk in enumerate(chunks, start=1):
    print(f"Uploading chunk {i} of {total}: {chunk['report_title']} — {chunk['section_heading']}")
    try:
        client.table("rugby_knowledge").insert({
            "report_title": chunk["report_title"],
            "section_heading": chunk["section_heading"],
            "content": chunk["content"],
            "full_text": chunk["full_text"],
            "embedding": chunk["embedding"],
            "category": "defence",
        }).execute()
        success += 1
    except Exception as e:
        print(f"  ERROR on chunk {i}: {type(e).__name__}: {e}")
        failed += 1
        if failed == 1:
            raise

print(f"\nDone. {success} uploaded, {failed} failed.")
