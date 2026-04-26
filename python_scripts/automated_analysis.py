"""
Automated match analysis pipeline.

Steps:
1. FFmpeg: split full match into 20-min chunks
2. Gemini (per chunk): detect IN_PLAY / DEAD_BALL sequences → cut into clips
3. Gemini (per clip): classify OUR_ATTACK / OUR_DEFENCE / DISCARD + analysis; discard if score < 6
4. Claude + pgvector RAG (per surviving clip): enrich with knowledge base
5. Claude: generate Attack + Defence reports with up to 3 themes each, 5 evidence clips each

DEBUG_MODE: when True, all intermediate files are preserved, raw API responses are printed
and logged, and every step's output is written to debug_output/job_<id>/pipeline_log.json.
"""

# ── Debug flag ─────────────────────────────────────────────────────────────────
DEBUG_MODE = False  # Set to True locally to preserve intermediate files and enable logging

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import threading
import uuid
import requests
from typing import Any, Callable, Dict, List, Optional
from datetime import datetime, timezone

from google import genai
from google.genai import types


# ── Chunk cleaning ─────────────────────────────────────────────────────────────

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


# ── Debug logger ───────────────────────────────────────────────────────────────

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEBUG_DIR = os.path.join(_SCRIPT_DIR, "debug_output")


class DebugLogger:
    """
    Per-job debug logger. When enabled:
    - Creates debug_output/job_<id>/ on disk.
    - log() prints the entry and appends it to pipeline_log.json.
    - All raw API responses are captured before any parsing or discard logic.
    """

    def __init__(self, job_id: str, enabled: bool):
        self.enabled = enabled
        self.job_id = job_id
        self._entries: List[Dict] = []
        self.dir: Optional[str] = None
        if enabled:
            self.dir = os.path.join(DEBUG_DIR, f"job_{job_id}")
            os.makedirs(self.dir, exist_ok=True)

    def log(self, step: str, **data: Any):
        """Print and persist a debug entry. No-op when disabled."""
        if not self.enabled:
            return
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "step": step,
            **data,
        }
        self._entries.append(entry)

        # Pretty-print to stdout (truncate very long raw responses for readability)
        print(f"\n{'=' * 70}")
        print(f"[DEBUG] {step}")
        for k, v in data.items():
            text = json.dumps(v, indent=2, default=str) if not isinstance(v, str) else v
            if len(text) > 3000:
                text = text[:3000] + "\n… (truncated)"
            print(f"  {k}:\n{text}")
        print("=" * 70, flush=True)

        self._flush()

    def _flush(self):
        if self.dir:
            log_path = os.path.join(self.dir, "pipeline_log.json")
            with open(log_path, "w") as f:
                json.dump(self._entries, f, indent=2, default=str)


# ── Job store ──────────────────────────────────────────────────────────────────

jobs: Dict[str, Dict[str, Any]] = {}


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    return jobs.get(job_id)


def update_job(job_id: str, **kwargs):
    if job_id in jobs:
        jobs[job_id].update(kwargs)


# ── Retry ──────────────────────────────────────────────────────────────────────

def retry_with_backoff(fn: Callable, max_retries: int = 3, base_delay: float = 2.0) -> Any:
    """Retry with exponential backoff: 2 s, 4 s, 8 s."""
    last_exc: Exception = RuntimeError("no attempts made")
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            if attempt < max_retries:
                time.sleep(base_delay * (2 ** attempt))
    raise last_exc


# ── FFmpeg helpers ─────────────────────────────────────────────────────────────

def compress_for_analysis(input_path: str, output_path: str) -> str:
    """
    Re-encode to 720p H.264 at ~1 Mbps — enough for Gemini to analyse kit
    colours and player positions, but ~4–6x smaller than a raw match recording.

    Prints file sizes before/after so the user can see the saving.
    Returns output_path.
    """
    before_mb = os.path.getsize(input_path) / (1024 * 1024)
    print(f"  [compress] Compressing for upload: {before_mb:.0f} MB → target ~720p/1 Mbps", flush=True)

    subprocess.run(
        [
            "ffmpeg", "-y", "-i", input_path,
            "-vf", "scale=-2:720",          # 720p, preserve aspect ratio
            "-c:v", "libx264",
            "-crf", "28",                   # quality/size balance (28 = good for analysis)
            "-preset", "fast",              # faster encode, slightly larger than 'slow'
            "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart",      # web-friendly
            output_path,
        ],
        capture_output=True, check=True,
    )

    after_mb = os.path.getsize(output_path) / (1024 * 1024)
    ratio = before_mb / after_mb if after_mb > 0 else 0
    print(f"  [compress] Done: {before_mb:.0f} MB → {after_mb:.0f} MB ({ratio:.1f}x smaller)", flush=True)
    return output_path


def get_video_duration(video_path: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", video_path],
        capture_output=True, text=True, check=True,
    )
    return float(json.loads(result.stdout)["format"]["duration"])


def chunk_video(input_path: str, temp_dir: str, chunk_seconds: int = 1200) -> List[Dict]:
    """
    Split video into chunks of up to chunk_seconds each.
    Returns list of {path, offset, index, duration}.
    """
    os.makedirs(temp_dir, exist_ok=True)
    total = get_video_duration(input_path)
    chunks = []
    start = 0.0
    idx = 0
    while start < total:
        end = min(start + chunk_seconds, total)
        path = os.path.join(temp_dir, f"chunk_{idx:03d}.mp4")
        subprocess.run(
            [
                "ffmpeg", "-y", "-ss", str(start), "-i", input_path,
                "-t", str(end - start), "-c", "copy",
                "-avoid_negative_ts", "make_zero", path,
            ],
            capture_output=True, check=True,
        )
        chunks.append({"path": path, "offset": start, "index": idx, "duration": end - start})
        start = end
        idx += 1
    return chunks


def cut_clip(input_path: str, start: float, end: float, output_path: str):
    subprocess.run(
        [
            "ffmpeg", "-y", "-ss", str(start), "-i", input_path,
            "-t", str(end - start), "-c", "copy",
            "-avoid_negative_ts", "make_zero", output_path,
        ],
        capture_output=True, check=True,
    )


# ── Gemini file upload cache (debug mode only) ────────────────────────────────
# Stores local-file → Gemini file name so reruns skip the upload entirely.
# Cache lives at debug_output/gemini_file_cache.json and persists across runs.

_GEMINI_CACHE_PATH = os.path.join(DEBUG_DIR, "gemini_file_cache.json")


def _cache_key(path: str) -> str:
    """Stable key: basename + file size (fast, good enough for testing)."""
    return f"{os.path.basename(path)}:{os.path.getsize(path)}"


def _load_gemini_cache() -> Dict[str, str]:
    try:
        with open(_GEMINI_CACHE_PATH) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_gemini_cache(cache: Dict[str, str]):
    os.makedirs(DEBUG_DIR, exist_ok=True)
    with open(_GEMINI_CACHE_PATH, "w") as f:
        json.dump(cache, f, indent=2)


# ── Gemini helpers ─────────────────────────────────────────────────────────────

def upload_to_gemini(
    path: str,
    gemini_client: genai.Client,
    mime: str = "video/mp4",
    process_timeout: int = 600,  # 10 min for Gemini server-side processing
):
    """
    Upload a file to Gemini Files API and wait until ACTIVE.
    In DEBUG_MODE, checks a local cache first — if the file was uploaded in a
    previous run and is still active on Gemini, the upload is skipped entirely.
    The upload itself has no hard timeout — it runs until complete.
    process_timeout: seconds before we give up waiting for Gemini to finish processing.
    """
    size_mb = os.path.getsize(path) / (1024 * 1024)
    filename = os.path.basename(path)

    # ── Cache check (debug only) ──────────────────────────────────────────────
    if DEBUG_MODE:
        cache = _load_gemini_cache()
        key = _cache_key(path)
        if key in cache:
            cached_name = cache[key]
            try:
                existing = gemini_client.files.get(name=cached_name)
                if existing.state.name == "ACTIVE":
                    print(
                        f"  [upload] Reusing cached Gemini file for {filename} "
                        f"({cached_name}) — skipping upload ✓",
                        flush=True,
                    )
                    return existing
                print(f"  [upload] Cached file {cached_name} is no longer active — re-uploading", flush=True)
            except Exception:
                print(f"  [upload] Cached file not found on Gemini — re-uploading", flush=True)

    print(f"  [upload] Starting upload: {filename} ({size_mb:.1f} MB) — no timeout", flush=True)

    uploaded = gemini_client.files.upload(
        file=path,
        config=types.UploadFileConfig(mime_type=mime),
    )

    print(f"  [upload] Upload complete — waiting for Gemini to process {filename}", flush=True)

    waited = 0
    while uploaded.state.name == "PROCESSING":
        time.sleep(5)
        waited += 5
        if waited % 30 == 0:
            print(f"  [upload] Still processing {filename} … ({waited}s elapsed)", flush=True)
        if waited > process_timeout:
            raise TimeoutError(
                f"Gemini processing of {filename} timed out after {process_timeout}s"
            )
        uploaded = gemini_client.files.get(name=uploaded.name)

    if uploaded.state.name == "FAILED":
        raise RuntimeError(f"Gemini video processing failed for {filename}")

    print(f"  [upload] {filename} ready ✓", flush=True)

    # ── Save to cache (debug only) ────────────────────────────────────────────
    if DEBUG_MODE:
        cache = _load_gemini_cache()
        cache[_cache_key(path)] = uploaded.name
        _save_gemini_cache(cache)
        print(f"  [upload] Cached as {uploaded.name}", flush=True)

    return uploaded


def delete_gemini_file(gemini_client: genai.Client, name: str):
    try:
        gemini_client.files.delete(name=name)
    except Exception:
        pass


def extract_json(text: str) -> Any:
    """Extract JSON (array or object) from a model response that may have fences."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    cleaned = re.sub(r"```(?:json)?\s*", "", text)
    cleaned = re.sub(r"```\s*$", "", cleaned, flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    for pattern in [r"(\[[\s\S]*\])", r"(\{[\s\S]*\})"]:
        m = re.search(pattern, text)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                pass
    raise ValueError(f"Cannot extract JSON from: {text[:300]}")


# ── Step 2: Sequence detection ─────────────────────────────────────────────────

SEQUENCE_DETECTION_PROMPT = """You are analysing a rugby match video clip.
Your task is to identify DEAD BALL periods only — time ranges where the ball is not in active play.

DEAD BALL Definition:
A DEAD BALL period begins when play is clearly stopped and ends the moment active play resumes.

Clear DEAD BALL indicators:
- Set piece setup: scrum or lineout forming (players stationary and organising)
- Referee stops play: whistle blown, arm raised, players disengage and stop contesting
- Conversion or penalty kick setup before the kick is taken
- Kick-off setup before the ball is kicked
- Injury stoppage or TMO review: players standing, waiting, no contest

NOT DEAD BALL — do not mark these as dead ball under any circumstances:
- Ball moving or being contested in any way
- Open play, even if slow or disorganised
- Advantage being played
- Ruck or maul forming or in progress after a tackle — this is IN PLAY even if movement pauses
- Transition moments where players are resetting but the referee has not stopped play

Boundary Rules:
- Start time: the moment play clearly stops (whistle, players fully disengage, ball dead)
- End time: the exact moment play restarts (ball thrown into lineout, scrum feed, kick taken, tap taken) — do NOT include the restart action itself inside the dead ball window
- Merge consecutive dead ball moments into a single window if no play occurs between them

Output Format:
Return ONLY a valid JSON array. Each element must contain:
  start — float, seconds from start of THIS clip
  end   — float, seconds from start of THIS clip

Example:
[
  {"start": 4.5, "end": 18.0},
  {"start": 45.2, "end": 63.8}
]

If the entire clip is dead ball → return one element covering the full duration
If no dead ball exists → return []
Return ONLY valid JSON. No explanation, no markdown, no trailing commas."""


def detect_sequences_in_chunk(
    chunk: Dict,
    gemini_client: genai.Client,
    logger: Optional[DebugLogger] = None,
) -> List[Dict]:
    """
    Pass 1: detect IN_PLAY sequences in a chunk.
    Returns list of {start, end, global_start, global_end} for IN_PLAY seqs >= 4s.

    In debug mode, logs the raw Gemini response before any FFmpeg cutting.
    """
    chunk_label = f"chunk_{chunk['index']:03d}"

    # Upload once — retries reuse the same file URI
    gf = upload_to_gemini(chunk["path"], gemini_client)
    try:
        def _infer():
            resp = gemini_client.models.generate_content(
                model="gemini-3.1-pro-preview",
                contents=[
                    types.Part.from_uri(file_uri=gf.uri, mime_type="video/mp4"),
                    SEQUENCE_DETECTION_PROMPT,
                ],
                config=types.GenerateContentConfig(
                    # Change 5: temperature=0 for deterministic dead ball detection
                    temperature=0,
                    http_options=types.HttpOptions(timeout=0),
                ),
            )
            raw_text = resp.text.strip()

            # ── Debug: log raw response BEFORE parsing or cutting ──────────
            if logger:
                logger.log(
                    f"Pass 1 — sequence detection ({chunk_label})",
                    chunk_index=chunk["index"],
                    chunk_offset_seconds=chunk["offset"],
                    chunk_duration_seconds=chunk["duration"],
                    raw_gemini_response=raw_text,
                )

            dead_balls = extract_json(raw_text)

            # Change 3a: merge dead ball windows that have < 3s of in-play
            # between them — that gap is noise, not a real sequence.
            dead_balls = sorted(dead_balls, key=lambda x: float(x["start"]))
            merged_dead_balls = []
            for db in dead_balls:
                db_start = float(db["start"])
                db_end = float(db["end"])
                if merged_dead_balls and db_start - merged_dead_balls[-1]["end"] < 3.0:
                    # Gap between consecutive dead ball windows is < 3s — merge them
                    merged_dead_balls[-1]["end"] = max(merged_dead_balls[-1]["end"], db_end)
                else:
                    merged_dead_balls.append({"start": db_start, "end": db_end})

            # Invert merged dead ball windows → IN_PLAY gaps
            chunk_duration = chunk["duration"]
            chunk_offset = chunk["offset"]
            in_play_windows = []
            prev_end = 0.0
            for db in merged_dead_balls:
                db_start = db["start"]
                db_end = db["end"]
                if db_start > prev_end + 0.1:
                    in_play_windows.append({"start": prev_end, "end": db_start})
                prev_end = max(prev_end, db_end)
            if prev_end < chunk_duration - 0.1:
                in_play_windows.append({"start": prev_end, "end": chunk_duration})

            # Change 2: log raw timestamps and offset-adjusted timestamps for debugging
            print(
                f"  [Pass 1] chunk_{chunk['index']:03d} offset={chunk_offset}s — "
                f"{len(merged_dead_balls)} dead ball window(s), "
                f"{len(in_play_windows)} raw in-play window(s) before filtering",
                flush=True,
            )

            # Change 3b/c: filter in-play windows — discard < 8s (noise) and > 90s
            # (likely a detection failure where dead ball was missed entirely).
            result = []
            discarded_short = 0
            discarded_long = 0
            for w in in_play_windows:
                start = float(w["start"])
                end = float(w["end"])
                duration = end - start
                if duration < 8.0:
                    discarded_short += 1
                    continue
                if duration > 90.0:
                    discarded_long += 1
                    continue
                global_start = start + chunk_offset
                global_end = end + chunk_offset
                print(
                    f"    → IN_PLAY: chunk {start:.1f}–{end:.1f}s "
                    f"| global {global_start:.1f}–{global_end:.1f}s "
                    f"| duration {duration:.1f}s",
                    flush=True,
                )
                result.append({
                    "start": start,
                    "end": end,
                    "global_start": global_start,
                    "global_end": global_end,
                })

            print(
                f"  [Pass 1] chunk_{chunk['index']:03d} — "
                f"kept {len(result)}, discarded {discarded_short} too-short (<8s), "
                f"{discarded_long} too-long (>90s)",
                flush=True,
            )
            return result

        return retry_with_backoff(_infer)
    finally:
        delete_gemini_file(gemini_client, gf.name)


# ── Step 3: Sequence analysis ──────────────────────────────────────────────────

def build_analysis_prompt(our_colour: str, opp_colour: str) -> str:
    # Change 6: our_colour and opp_colour are currently passed in from the user-submitted
    # form at /automated_analysis. They are free-text strings (e.g. "red and black").
    # TODO: pull kit colours from the team_profiles table in Supabase instead of relying
    # on manual user input — this ensures consistency across sessions and removes the risk
    # of typos or mismatched descriptions affecting classification accuracy.
    return f"""You are analysing a single rugby sequence clip.
Our team kit colour: {our_colour}
Opposition kit colour: {opp_colour}

Your Tasks

1. Raw Description (STRICTLY factual)
Describe exactly what happens in the clip:
- Who has possession at each moment (identify by kit colour)
- What actions occur (passes, carries, kicks, tackles, rucks, etc.)
- Field positioning if visible (e.g., wide channel, midfield, near try line)
- Approximately how many phases occur if multiple phases take place
- How the sequence ends (turnover, kick, knock-on, try, etc.)

Rules:
- 4–6 sentences only
- No interpretation, no assumptions about intent
- Do NOT infer anything not clearly visible
- If visibility is unclear, say so explicitly

2. Classification
Classify the clip as ONE of:
- "OUR_ATTACK"  — {our_colour} team has possession for >60% of the clip and is the primary attacking team
- "OUR_DEFENCE" — {opp_colour} team has possession for >60% of the clip
- "DISCARD"     — no clear majority possession, broken sequence, or no meaningful tactical content

Edge case rules:
- Identify possession by which team is carrying or controlling the ball — NOT by which team has more players visible in frame
- If possession changes once but one team is still dominant → classify normally
- If chaotic, unclear, or too short → use "DISCARD"

3. Tactical Analysis (interpretation)
Provide a 2–3 sentence explanation of:
- The apparent tactical intent
- Whether it was effective
- Why (based ONLY on visible actions)

4. Relevancy Score (1–10)
- 9–10 → Multi-phase, clear structure, high coaching value
- 7–8  → Clear tactical idea with useful insight
- 5–6  → Some structure but limited depth
- 3–4  → Brief, unclear, or low value
- 1–2  → No meaningful content (likely DISCARD)

5. Tactical Themes
Return 1–3 concise theme labels:
- 2–4 words each
- Must be directly supported by what is visible in the clip
- Use standard rugby terminology
- Do NOT invent abstract or vague themes

Valid examples: "blitz defence", "wide offload chain", "breakdown turnover", "lineout drive", "defensive line speed", "set piece platform"

Output Format (STRICT)
Return ONLY valid JSON in this EXACT structure:
{{
  "classification": "OUR_ATTACK",
  "raw_description": "Factual play-by-play of what physically happens in the clip, including phase count if applicable.",
  "tactical_analysis": "Concise tactical interpretation based on visible actions only.",
  "relevancy_score": 7,
  "tactical_themes": ["theme one", "theme two"]
}}

Global Rules (CRITICAL)
- Output ONLY valid JSON — no markdown, no extra text
- Do NOT include trailing commas
- Do NOT hallucinate unseen details
- Maintain strict separation:
  raw_description = WHAT happened
  tactical_analysis = WHY it happened"""


def analyse_sequence_clip(
    clip_path: str,
    our_colour: str,
    opp_colour: str,
    gemini_client: genai.Client,
    clip_label: str = "",
    logger: Optional[DebugLogger] = None,
) -> Dict:
    """
    Pass 2: classify and analyse a sequence clip.

    In debug mode, logs the full Gemini response before discard logic runs.
    """
    prompt = build_analysis_prompt(our_colour, opp_colour)

    # Upload once — retries reuse the same file URI
    gf = upload_to_gemini(clip_path, gemini_client)
    try:
        def _infer():
            resp = gemini_client.models.generate_content(
                model="gemini-3.1-pro-preview",
                contents=[
                    types.Part.from_uri(file_uri=gf.uri, mime_type="video/mp4"),
                    prompt,
                ],
                config=types.GenerateContentConfig(
                    # Change 5: temperature=0 for consistent, deterministic classification
                    temperature=0,
                    http_options=types.HttpOptions(timeout=0),
                ),
            )
            raw_text = resp.text.strip()

            # ── Debug: log raw response BEFORE discard logic ───────────────
            if logger:
                logger.log(
                    f"Pass 2 — sequence analysis ({clip_label or os.path.basename(clip_path)})",
                    clip_path=clip_path,
                    raw_gemini_response=raw_text,
                )

            return extract_json(raw_text)

        return retry_with_backoff(_infer)
    finally:
        delete_gemini_file(gemini_client, gf.name)


# ── Step 4: RAG enrichment ─────────────────────────────────────────────────────

RAG_PROMPT_TEMPLATE = """You are a rugby coaching analyst enriching a clip analysis with applied coaching insight.

Inputs:
SEQUENCE CLASSIFICATION: {classification}
WHAT HAPPENED (FACTUAL): {raw_description}
TACTICAL INTERPRETATION: {tactical_analysis}
INITIAL TACTICAL THEMES (from video analysis): {pass2_themes}
{knowledge_section}

Your Task
Produce highly specific, evidence-based coaching outputs grounded in the clip.
Your output must strictly reflect:
- The events described in raw_description
- The logic in tactical_analysis
- The principles in the knowledge section above (if provided)

1. Tactical Themes
The video analysis identified these initial themes: {pass2_themes}
Review them against the clip data. Confirm each one if accurate, refine the terminology if imprecise, or replace if clearly wrong.
Return 1–3 concise theme labels:
- 2–4 words each
- Must clearly emerge from the clip — not generic rugby concepts
- Prefer the initial themes where they are accurate

2. Observations (CRITICAL)
Provide 2–3 observations that:
- Directly reference specific moments or actions from raw_description
- Explain why those actions matter tactically
- Are written as cause → effect statements

Format:
- "Because [specific action from clip], [tactical outcome occurred]"
- "The [specific action] led to [specific outcome]"

Strict rules:
- Do NOT introduce new events, players, or assumptions not present in raw_description
- Do NOT repeat the raw description — add insight
- Avoid vague language (e.g. "good spacing", "nice play")
- If raw_description lacks sufficient detail to support an observation, state this explicitly: "Insufficient clip detail to assess [theme]" — do NOT infer or fabricate

3. Coaching Cues
Provide 1–2 actionable coaching cues:
- Must be directly derived from the observations
- Must be clear, instructive, and transferable to training
- Should describe what players should DO, not just what happened
- Must be written from the perspective of the classified team:
  if OUR_ATTACK → cue our attacking players
  if OUR_DEFENCE → cue our defenders

Good examples:
- "Fix the edge defender before passing to create the overlap"
- "Reload quickly into the defensive line after the tackle"

4. Significance Score (1–10)
- 9–10 → Very clear example of a tactical concept, excellent teaching clip
- 7–8  → Strong example with clear learning value
- 5–6  → Moderate value, somewhat situational
- 3–4  → Limited clarity or usefulness
- 1–2  → Minimal or no coaching value

Knowledge Usage Rules (IMPORTANT)
- Use the provided knowledge to inform your output but do not reference, cite, quote, or mention any document names, section headers, or source frameworks. The knowledge should shape your output invisibly — never surface it.
- If coaching knowledge is provided, use it only to support or explain what is visible in the clip
- If no knowledge is provided (see RELEVANT COACHING KNOWLEDGE above), base observations solely on raw_description and tactical_analysis — do NOT substitute general rugby theory
- Do NOT introduce concepts not evidenced in the clip
- Do NOT override the clip with generic theory

Output Format (STRICT)
Return ONLY valid JSON:
{{
  "tactical_themes": ["specific theme 1", "specific theme 2"],
  "observations": [
    "Because [specific action from clip], [tactical outcome occurred]",
    "Because [specific action from clip], [tactical outcome occurred]"
  ],
  "coaching_cues": [
    "Actionable instruction derived from the clip"
  ],
  "significance_score": 7
}}

Global Rules (CRITICAL)
- Output ONLY valid JSON — no markdown, no explanation
- No hallucinations — only use provided inputs
- Every observation MUST clearly tie back to raw_description
- Maintain clarity and specificity over quantity
- Prefer fewer, higher-quality insights over generic coverage"""


def enrich_clip_with_rag(
    clip: Dict,
    supabase,
    anthropic_api_key: str,
    embed_fn: Callable,
    clip_label: str = "",
    logger: Optional[DebugLogger] = None,
) -> Dict:
    """
    Pass 3: enrich a clip with RAG coaching knowledge via Claude.

    In debug mode, logs the full Claude JSON output before it is merged.
    """
    classification = clip["classification"]
    category = "attack" if classification == "OUR_ATTACK" else "defence"
    search_text = " ".join(clip.get("tactical_themes", [])) + " " + clip.get("tactical_analysis", "")

    knowledge_parts = []
    try:
        embedding = embed_fn(search_text[:800])
        result = supabase.rpc(
            "match_rugby_knowledge",
            {"query_embedding": embedding, "match_count": 5, "filter_category": category},
        ).execute()
        for row in (result.data or []):
            if row.get("similarity", 0) >= 0.70:
                cleaned = clean_chunk(row.get('content', ''))
                if cleaned:
                    knowledge_parts.append(cleaned)
    except Exception:
        pass

    pass2_themes = clip.get("tactical_themes", [])
    pass2_themes_str = ", ".join(pass2_themes) if pass2_themes else "none identified"

    if knowledge_parts:
        knowledge_section = "RELEVANT COACHING KNOWLEDGE:\n" + "\n\n".join(knowledge_parts)
    else:
        knowledge_section = "RELEVANT COACHING KNOWLEDGE: [None retrieved — base analysis solely on raw_description and tactical_analysis above. Do not invent principles.]"

    prompt = RAG_PROMPT_TEMPLATE.format(
        classification=classification,
        raw_description=clip.get("raw_description", ""),
        tactical_analysis=clip.get("tactical_analysis", ""),
        pass2_themes=pass2_themes_str,
        knowledge_section=knowledge_section,
    )

    def _call():
        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": anthropic_api_key,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": "claude-sonnet-4-6",
                "max_tokens": 2048,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=60,
        )
        resp.raise_for_status()
        raw_text = resp.json()["content"][0]["text"]

        # ── Debug: log raw Claude response BEFORE merging ──────────────────
        if logger:
            logger.log(
                f"Pass 3 — RAG enrichment ({clip_label or os.path.basename(clip.get('path', ''))})",
                clip_path=clip.get("path", ""),
                classification=classification,
                knowledge_chunks_used=len(knowledge_parts),
                raw_claude_response=raw_text,
            )

        return extract_json(raw_text)

    enrichment = retry_with_backoff(_call)
    return {
        **clip,
        "tactical_themes": enrichment.get("tactical_themes", clip.get("tactical_themes", [])),
        "observations": enrichment.get("observations", []),
        "coaching_cues": enrichment.get("coaching_cues", []),
        "significance_score": enrichment.get("significance_score", clip.get("relevancy_score", 5)),
    }


# ── Step 5: Report generation ──────────────────────────────────────────────────

def _fmt_ts(seconds: float) -> str:
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m}:{s:02d}"


def _clip_timestamp(clip: Dict) -> str:
    return f"{_fmt_ts(clip.get('global_start', 0.0))}–{_fmt_ts(clip.get('global_end', 0.0))}"


_MATCH_REPORT_PROMPT = """\
You are a rugby head coach producing a structured post-match {phase} coaching report.

Below are {phase} clips from the match. Each has been individually analysed.

CLIPS:
{clips_text}

YOUR TASK
Identify recurring tactical themes across these clips — not individual events.
Group clips under themes and place each theme in the correct subsection.

SUBSECTION DEFINITIONS

KEY TAKEAWAYS
The 1–2 most important themes from this {phase} phase — positive or negative.
These are what the coach must communicate to the team. Prefer multi-clip evidence.

POSITIVES
Themes showing consistent, well-executed {phase} patterns.
0–3 themes. Only genuine recurring strengths — do not manufacture positives.

WORK ONS
Themes showing clear, repeated issues or execution failures. Most critical first.
0–3 themes.

CLIP RULES
- Select 2–3 clips per theme that most clearly demonstrate THAT specific theme
- relevance_score (1–10): how directly this clip illustrates this specific theme
- A clip may appear under multiple themes only where it directly supports the point
- description: 1 sentence — what this clip shows that supports the theme

QUALITY RULES
- Do NOT invent themes not evidenced in the clips
- If fewer than 2 clips support a theme, merge or drop it
- Prefer strong evidence in fewer themes over weak coverage across many

Return ONLY valid JSON. No markdown, no explanation:
{{
  "report_type": "match",
  "phases": [
    {{
      "name": "{phase}",
      "subsections": [
        {{
          "name": "Key Takeaways",
          "themes": [
            {{
              "title": "3–5 word theme title",
              "summary": "1–2 sentence coaching observation grounded in clip evidence",
              "clips": [
                {{
                  "clip_id": "clip_id value from input",
                  "timestamp": "timestamp value from input",
                  "description": "1 sentence: what this clip shows that supports the theme",
                  "relevance_score": 9
                }}
              ]
            }}
          ]
        }},
        {{
          "name": "Positives",
          "themes": []
        }},
        {{
          "name": "Work Ons",
          "themes": []
        }}
      ]
    }}
  ]
}}\
"""


def build_report_prompt(clips: List[Dict], report_type: str, top_n: int = 15) -> str:
    phase = report_type.lower()

    # Pre-filter: top N by significance, preserving original indices for resolution.
    if len(clips) > top_n:
        indexed = sorted(enumerate(clips), key=lambda x: x[1].get("significance_score", 0), reverse=True)[:top_n]
        indexed.sort(key=lambda x: x[0])
    else:
        indexed = list(enumerate(clips))

    parts = []
    for orig_idx, clip in indexed:
        ts = _clip_timestamp(clip)
        themes_str = ", ".join(clip.get("tactical_themes", [])) or "none"
        obs_str = "; ".join(clip.get("observations", [])) or "none"
        parts.append(
            f'clip_id: "{orig_idx}" | timestamp: "{ts}" | significance: {clip.get("significance_score", 5)}/10\n'
            f'themes: {themes_str}\n'
            f'description: {clip.get("raw_description", "")}\n'
            f'observations: {obs_str}'
        )

    return _MATCH_REPORT_PROMPT.format(phase=phase, clips_text="\n\n---\n\n".join(parts))


def generate_match_report(
    clips: List[Dict],
    report_type: str,
    anthropic_api_key: str,
    logger: Optional[DebugLogger] = None,
) -> Dict:
    from report_models import Report  # local import to avoid circular issues at module level

    phase = report_type.lower()
    empty_subsections = [
        {"name": "Key Takeaways", "themes": []},
        {"name": "Positives", "themes": []},
        {"name": "Work Ons", "themes": []},
    ]

    if not clips:
        return {
            "report_type": "match",
            "phases": [{"name": phase, "subsections": empty_subsections}],
        }

    prompt = build_report_prompt(clips, report_type)

    def _call():
        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": anthropic_api_key,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": "claude-sonnet-4-6",
                "max_tokens": 4000,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=120,
        )
        resp.raise_for_status()
        raw_text = resp.json()["content"][0]["text"]

        if logger:
            logger.log(
                f"Pass 5 — report generation ({report_type})",
                report_type=report_type,
                clip_count=len(clips),
                raw_claude_response=raw_text,
            )

        data = extract_json(raw_text)
        validated = Report.model_validate(data)
        return validated.model_dump()

    return retry_with_backoff(_call)


# ── Evidence clip resolution helpers ──────────────────────────────────────────

def collect_evidence_clip_ids(report: Dict) -> set:
    """Walk the Report tree and collect all integer clip_id references."""
    ids: set = set()
    for phase in report.get("phases", []):
        for subsection in phase.get("subsections", []):
            for theme in subsection.get("themes", []):
                for clip in theme.get("clips", []):
                    cid = clip.get("clip_id")
                    if cid is not None:
                        try:
                            ids.add(int(cid))
                        except (ValueError, TypeError):
                            pass
    return ids


def resolve_report_clips(report: Dict, saved_map: Dict[int, Dict]) -> Dict:
    """Replace integer clip_id strings with real UUIDs and clip_urls from saved_map."""
    for phase in report.get("phases", []):
        for subsection in phase.get("subsections", []):
            for theme in subsection.get("themes", []):
                resolved = []
                for clip in theme.get("clips", []):
                    try:
                        orig_idx = int(clip.get("clip_id", ""))
                    except (ValueError, TypeError):
                        continue
                    saved = saved_map.get(orig_idx)
                    if saved:
                        resolved.append({
                            **clip,
                            "clip_id": saved["id"],
                            "clip_url": saved["clip_url"],
                        })
                theme["clips"] = resolved
    return report


# ── Save evidence clips to Supabase ───────────────────────────────────────────

def save_evidence_clip(
    clip_path: str,
    match_id: str,
    user_id: str,
    tag: str,
    start_time: float,
    end_time: float,
    clip_data: Dict,
    supabase,
) -> Optional[Dict]:
    filename = f"{uuid.uuid4()}.mp4"
    storage_path = f"clips/{filename}"

    with open(clip_path, "rb") as f:
        supabase.storage.from_("match-clips").upload(
            path=storage_path,
            file=f,
            file_options={"content-type": "video/mp4", "upsert": "true"},
        )

    clip_url = supabase.storage.from_("match-clips").get_public_url(storage_path)
    label = "Auto: " + ", ".join(clip_data.get("tactical_themes", [])[:2])

    # Change 3: build analysis_output as JSON so the admin page and future
    # consumers can parse all fields reliably. Keep writing to analysis_output
    # as well as the new dedicated columns until the migration is confirmed stable.
    observations = clip_data.get("observations", [])
    raw_description = clip_data.get("raw_description", "")
    analysis_output_json = json.dumps({
        "raw_description": raw_description,
        "observations": observations,
        "tactical_themes": clip_data.get("tactical_themes", []),
        "significance_score": clip_data.get("significance_score"),
        "relevancy_score": clip_data.get("relevancy_score"),
        "coaching_cues": clip_data.get("coaching_cues", []),
    })

    record = supabase.table("clips").insert({
        "match_path": "auto",
        "clip_path": storage_path,
        "clip_url": clip_url,
        "start_time": start_time,
        "end_time": end_time,
        "tag": tag,
        "label": label or None,
        "match_id": match_id,
        "user_id": user_id,
        # Legacy field — kept until migration is confirmed stable
        "analysis_output": analysis_output_json,
        # Change 3: dedicated columns added by migration 20260408000000
        "raw_description": raw_description or None,
        "observations": observations or None,
        "status": "complete",
        "excluded": False,
    }).execute()

    return record.data[0] if record.data else None


def resolve_evidence_clips(report: Dict, saved_map: Dict[int, Dict]) -> Dict:
    """Replace clip_index references with actual Supabase clip data."""
    for section in ("went_well", "work_on"):
        for theme in report.get(section, []):
            resolved = []
            for ec in theme.get("evidence_clips", []):
                saved = saved_map.get(ec["clip_index"])
                if saved:
                    resolved.append({
                        "clip_id": saved["id"],
                        "clip_url": saved["clip_url"],
                        "explanation": ec.get("explanation", ""),
                        "significance_score": ec.get("significance_score", 5),
                    })
            theme["evidence_clips"] = resolved
    return report


# ── Main pipeline ──────────────────────────────────────────────────────────────

def run_automated_pipeline(
    job_id: str,
    video_path: str,
    our_colour: str,
    opp_colour: str,
    match_id: str,
    user_id: str,
    gemini_client: genai.Client,
    anthropic_api_key: str,
    supabase,
    embed_fn: Callable,
):
    """Main pipeline. Runs in a background thread; updates jobs[job_id] throughout."""
    temp_dir = os.path.join(os.path.dirname(video_path), f"job_{job_id}")
    os.makedirs(temp_dir, exist_ok=True)

    logger = DebugLogger(job_id=job_id, enabled=DEBUG_MODE)

    if DEBUG_MODE:
        print(f"\n[DEBUG] Pipeline starting — job {job_id}")
        print(f"[DEBUG] Debug output directory: {logger.dir}")
        print(f"[DEBUG] Temp files will NOT be deleted this run.\n")

    def _safe_remove(path: str):
        """Delete a file only when debug mode is off."""
        if DEBUG_MODE:
            return
        try:
            os.remove(path)
        except Exception:
            pass

    def _cleanup():
        """Remove the job temp dir and uploaded video, only when debug mode is off."""
        if DEBUG_MODE:
            return
        shutil.rmtree(temp_dir, ignore_errors=True)
        try:
            os.remove(video_path)
        except Exception:
            pass

    try:
        # ── Step 0: Compress ─────────────────────────────────────────────────
        update_job(job_id, current_step=1, step_name="Compressing video for upload",
                   current_chunk=0, total_chunks=0)
        compressed_path = os.path.join(temp_dir, "compressed.mp4")
        compress_for_analysis(video_path, compressed_path)
        if not DEBUG_MODE:
            try:
                os.remove(video_path)
            except Exception:
                pass

        # ── Step 1: Chunk ────────────────────────────────────────────────────
        # Change 1: chunk size enforced at 4 minutes (240s) so Gemini handles
        # a manageable window per Pass 1 call — improves detection accuracy
        # and avoids very long inference times on large chunks.
        update_job(job_id, current_step=1, step_name="Splitting match into 4-minute chunks",
                   current_chunk=0, total_chunks=0)
        chunks = chunk_video(compressed_path, temp_dir, chunk_seconds=240)
        update_job(job_id, total_chunks=len(chunks))

        if DEBUG_MODE:
            logger.log(
                "Pass 1 — chunking complete",
                total_chunks=len(chunks),
                chunks=[{"index": c["index"], "offset": c["offset"],
                          "duration": c["duration"], "path": c["path"]} for c in chunks],
            )

        # ── Step 2: Sequence detection ───────────────────────────────────────
        update_job(job_id, current_step=2, step_name="Detecting sequences",
                   current_chunk=0, total_chunks=len(chunks))

        all_sequences: List[Dict] = []
        failed_chunks: List[Dict] = []

        for chunk in chunks:
            update_job(job_id, current_chunk=chunk["index"] + 1)
            try:
                sequences = detect_sequences_in_chunk(chunk, gemini_client, logger=logger)
                for seq_idx, seq in enumerate(sequences):
                    out = os.path.join(temp_dir, f"seq_{chunk['index']:03d}_{seq_idx:04d}.mp4")
                    cut_clip(chunk["path"], seq["start"], seq["end"], out)
                    all_sequences.append({
                        "path": out,
                        "global_start": seq["global_start"],
                        "global_end": seq["global_end"],
                        "chunk_idx": chunk["index"],
                    })
            except Exception as exc:
                failed_chunks.append({"index": chunk["index"] + 1, "error": str(exc)})
            finally:
                _safe_remove(chunk["path"])

        if failed_chunks:
            update_job(job_id, failed_chunks=failed_chunks)

        if not all_sequences:
            raise RuntimeError(
                "No sequences could be extracted. "
                + (f"Failed chunks: {failed_chunks}" if failed_chunks else "")
            )

        update_job(job_id, clips_detected=len(all_sequences))

        # ── Step 3: Sequence analysis ────────────────────────────────────────
        update_job(job_id, current_step=3, step_name="Classifying and analysing sequences",
                   current_chunk=0, total_chunks=len(all_sequences))

        attack_clips: List[Dict] = []
        defence_clips: List[Dict] = []

        for i, seq in enumerate(all_sequences):
            update_job(job_id, current_chunk=i + 1)
            clip_label = f"seq_{seq['chunk_idx']:03d}_{i:04d}"
            try:
                result = analyse_sequence_clip(
                    seq["path"], our_colour, opp_colour, gemini_client,
                    clip_label=clip_label, logger=logger,
                )
                classification = result.get("classification", "DISCARD")
                score = int(result.get("relevancy_score", 0))
                raw_description = result.get("raw_description", "")

                # Change 4: Post-Pass 2 relevancy filtering — check three conditions
                # before allowing a clip through to Pass 3. Log each discard with reason.
                discard_reason = None
                if classification == "DISCARD":
                    discard_reason = "classification=DISCARD"
                elif score <= 4:
                    # Changed from < 6 to <= 4 per audit — clips scoring 5 may still
                    # have marginal coaching value and are worth enriching.
                    discard_reason = f"relevancy_score={score} (≤4)"
                elif raw_description.count(".") < 2:
                    # Fewer than 2 full stops = likely fewer than 3 sentences,
                    # indicating the model couldn't describe the clip reliably.
                    discard_reason = f"raw_description too short ({raw_description.count('.')} full stops)"

                if discard_reason:
                    print(f"  [Pass 2] DISCARD {clip_label}: {discard_reason}", flush=True)
                    _safe_remove(seq["path"])
                    continue

                clip = {
                    **seq,
                    "classification": classification,
                    "raw_description": result.get("raw_description", ""),
                    "tactical_analysis": result.get("tactical_analysis", ""),
                    "relevancy_score": score,
                    "tactical_themes": result.get("tactical_themes", []),
                }
                if classification == "OUR_ATTACK":
                    attack_clips.append(clip)
                elif classification == "OUR_DEFENCE":
                    defence_clips.append(clip)
                else:
                    _safe_remove(seq["path"])

            except Exception:
                _safe_remove(seq["path"])

        update_job(job_id, clips_kept=len(attack_clips) + len(defence_clips))

        # ── Step 4: RAG enrichment ────────────────────────────────────────────
        all_to_enrich = attack_clips + defence_clips
        update_job(job_id, current_step=4, step_name="Enriching with coaching knowledge",
                   current_chunk=0, total_chunks=len(all_to_enrich))

        enriched_attack: List[Dict] = []
        enriched_defence: List[Dict] = []
        counter = 0

        for idx, clip in enumerate(attack_clips):
            counter += 1
            update_job(job_id, current_chunk=counter)
            clip_label = f"attack_{idx:04d}"
            try:
                enriched_attack.append(
                    enrich_clip_with_rag(clip, supabase, anthropic_api_key, embed_fn,
                                         clip_label=clip_label, logger=logger)
                )
            except Exception:
                enriched_attack.append(clip)

        for idx, clip in enumerate(defence_clips):
            counter += 1
            update_job(job_id, current_chunk=counter)
            clip_label = f"defence_{idx:04d}"
            try:
                enriched_defence.append(
                    enrich_clip_with_rag(clip, supabase, anthropic_api_key, embed_fn,
                                         clip_label=clip_label, logger=logger)
                )
            except Exception:
                enriched_defence.append(clip)

        # ── Step 5: Report generation ─────────────────────────────────────────
        update_job(job_id, current_step=5, step_name="Generating match reports",
                   current_chunk=0, total_chunks=0)

        attack_report = generate_match_report(
            enriched_attack, "Attack", anthropic_api_key, logger=logger
        )
        defence_report = generate_match_report(
            enriched_defence, "Defence", anthropic_api_key, logger=logger
        )

        # ── Save evidence clips ───────────────────────────────────────────────
        update_job(job_id, step_name="Saving evidence clips")

        attack_indices = collect_evidence_clip_ids(attack_report)
        defence_indices = collect_evidence_clip_ids(defence_report)

        attack_saved: Dict[int, Dict] = {}
        for idx in attack_indices:
            if idx < len(enriched_attack):
                clip = enriched_attack[idx]
                try:
                    saved = save_evidence_clip(
                        clip["path"], match_id, user_id, "attack",
                        clip["global_start"], clip["global_end"], clip, supabase,
                    )
                    if saved:
                        attack_saved[idx] = saved
                except Exception:
                    pass

        defence_saved: Dict[int, Dict] = {}
        for idx in defence_indices:
            if idx < len(enriched_defence):
                clip = enriched_defence[idx]
                try:
                    saved = save_evidence_clip(
                        clip["path"], match_id, user_id, "defence",
                        clip["global_start"], clip["global_end"], clip, supabase,
                    )
                    if saved:
                        defence_saved[idx] = saved
                except Exception:
                    pass

        attack_report = resolve_report_clips(attack_report, attack_saved)
        defence_report = resolve_report_clips(defence_report, defence_saved)

        # ── Persist to session_reports ────────────────────────────────────────
        for report, report_type in [(attack_report, "auto_attack"), (defence_report, "auto_defence")]:
            supabase.table("session_reports").delete().match(
                {"session_id": match_id, "report_type": report_type, "user_id": user_id}
            ).execute()
            supabase.table("session_reports").insert(
                {
                    "session_id": match_id,
                    "report_type": report_type,
                    "user_id": user_id,
                    "report_data": report,
                }
            ).execute()

        # ── Clean up remaining sequence files ────────────────────────────────
        for clip in enriched_attack + enriched_defence:
            if os.path.exists(clip.get("path", "")):
                _safe_remove(clip["path"])

        _cleanup()

        if DEBUG_MODE:
            logger.log(
                "Pipeline complete",
                attack_clips_enriched=len(enriched_attack),
                defence_clips_enriched=len(enriched_defence),
                attack_evidence_clips_saved=len(attack_saved),
                defence_evidence_clips_saved=len(defence_saved),
                debug_log_path=os.path.join(logger.dir, "pipeline_log.json"),
            )

        update_job(
            job_id,
            status="complete",
            current_step=5,
            step_name="Complete",
            attack_report=attack_report,
            defence_report=defence_report,
        )

    except Exception as exc:
        _cleanup()
        update_job(job_id, status="failed", error=str(exc))
