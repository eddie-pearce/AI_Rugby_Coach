import json
import os
import re

REPORTS_DIR = os.path.join(os.path.dirname(__file__), "RugbyUnionDefenceKnowledge")
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "defence_chunks.json")

# Matches markdown headings: #### 1\. OVERVIEW
# Also matches bold headings: **1\. OVERVIEW: ...**
HEADING_RE = re.compile(
    r"(?:^#{1,6}\s+\d+\\?\.\s+(.+)|\*\*(\d+\\?\.\s+[^*]+)\*\*)",
    re.MULTILINE
)

def split_into_chunks(text, report_title):
    chunks = []
    matches = list(HEADING_RE.finditer(text))

    for i, match in enumerate(matches):
        heading_text = (match.group(1) or match.group(2)).strip()
        content_start = match.end()
        content_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        content = text[content_start:content_end].strip()

        full_text = f"{report_title}\n{heading_text}\n{content}"

        chunks.append({
            "report_title": report_title,
            "section_heading": heading_text,
            "content": content,
            "full_text": full_text,
        })

    return chunks


all_chunks = []

md_files = sorted(
    f for f in os.listdir(REPORTS_DIR) if f.endswith(".md")
)

for filename in md_files:
    report_title = filename[:-3]  # strip .md
    filepath = os.path.join(REPORTS_DIR, filename)
    with open(filepath, "r", encoding="utf-8") as f:
        text = f.read()

    chunks = split_into_chunks(text, report_title)
    all_chunks.extend(chunks)
    print(f"Processed: {filename}  ({len(chunks)} chunks)")

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(all_chunks, f, indent=2, ensure_ascii=False)

print(f"\nTotal chunks: {len(all_chunks)}")
print(f"Saved to: {OUTPUT_FILE}")
