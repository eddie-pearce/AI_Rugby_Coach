import os

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


def embed_query(query: str) -> list[float]:
    result = gemini.models.embed_content(
        model="models/gemini-embedding-001",
        contents=query,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY"),
    )
    return result.embeddings[0].values


def retrieve_relevant_chunks(query: str, top_k: int = 5, category: str = "attack") -> list[dict]:
    query_embedding = embed_query(query)

    response = supabase.rpc(
        "match_rugby_knowledge",
        {"query_embedding": query_embedding, "match_count": top_k, "filter_category": category},
    ).execute()

    return response.data


if __name__ == "__main__":
    query = "creating space in attack and exploiting defensive drift"
    print(f"Query: {query}\n")

    results = retrieve_relevant_chunks(query, top_k=5)

    for i, chunk in enumerate(results, start=1):
        print(f"--- Result {i} ---")
        print(f"Report:    {chunk['report_title']}")
        print(f"Section:   {chunk['section_heading']}")
        print(f"Similarity:{chunk['similarity']:.4f}")
        print(f"Content:   {chunk['content'][:300]}...")
        print()
