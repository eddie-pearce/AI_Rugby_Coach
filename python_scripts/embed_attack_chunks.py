import json
import os
import time

from google import genai
from google.genai import types

CHUNKS_FILE = os.path.join(os.path.dirname(__file__), "attack_chunks.json")
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "attack_chunks_embedded.json")
MODEL = "models/gemini-embedding-001"
DELAY_SECONDS = 0.5  # stay well under the 1,500 RPM free-tier limit

api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
    raise EnvironmentError("GEMINI_API_KEY environment variable is not set.")

client = genai.Client(api_key=api_key)

with open(CHUNKS_FILE, "r", encoding="utf-8") as f:
    chunks = json.load(f)

total = len(chunks)

for i, chunk in enumerate(chunks, start=1):
    print(f"Embedding chunk {i} of {total}...")

    result = client.models.embed_content(
        model=MODEL,
        contents=chunk["full_text"],
        config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
    )

    chunk["embedding"] = result.embeddings[0].values

    time.sleep(DELAY_SECONDS)

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(chunks, f, indent=2, ensure_ascii=False)

print(f"\nDone. {total} chunks embedded.")
print(f"Saved to: {OUTPUT_FILE}")
