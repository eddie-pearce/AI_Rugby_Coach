import { createClient } from "@supabase/supabase-js";

type ServiceClient = ReturnType<typeof createClient>;

export interface SuggestedDrill {
  title: string;
  setup: string;
  key_focus: string;
  progression: string;
}

async function embedQuery(text: string): Promise<number[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: "RETRIEVAL_QUERY",
          content: { parts: [{ text }] },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json() as { embedding?: { values?: number[] } };
    return data.embedding?.values ?? null;
  } catch {
    return null;
  }
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*\*\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(text: string, max: number): string {
  const cleaned = cleanMarkdown(text);
  if (cleaned.length <= max) return cleaned;
  const boundary = cleaned.lastIndexOf(" ", max);
  return (boundary > max * 0.8 ? cleaned.slice(0, boundary) : cleaned.slice(0, max)) + "…";
}

function findSection(sections: Record<string, string>, keywords: string[]): string {
  for (const [heading, content] of Object.entries(sections)) {
    const upper = heading.toUpperCase();
    if (keywords.some((kw) => upper.includes(kw))) {
      return truncate(content, 450);
    }
  }
  return "";
}

export async function fetchSuggestedDrills(
  queryText: string,
  supabase: ServiceClient
): Promise<SuggestedDrill[]> {
  if (!queryText.trim()) return [];
  try {
    const embedding = await embedQuery(queryText);
    if (!embedding) {
      console.error("[drillSearch] embedQuery returned null — check GOOGLE_API_KEY");
      return [];
    }

    const { data: chunks, error } = await supabase.rpc("match_rugby_knowledge", {
      query_embedding: embedding,
      match_count: 15,
      filter_category: "drills",
    });
    if (error) { console.error("[drillSearch] RPC error:", error.message); return []; }
    if (!chunks?.length) { console.warn("[drillSearch] RPC returned no chunks"); return []; }

    // Deduplicate by report_title, take top 3 unique drills
    const seen = new Set<string>();
    const topTitles: string[] = [];
    for (const chunk of chunks as { report_title: string }[]) {
      if (!seen.has(chunk.report_title)) {
        seen.add(chunk.report_title);
        topTitles.push(chunk.report_title);
        if (topTitles.length === 3) break;
      }
    }
    if (!topTitles.length) return [];

    // Fetch all sections for the top 3 drills in one query
    const { data: allSections } = await supabase
      .from("rugby_knowledge")
      .select("report_title, section_heading, content")
      .in("report_title", topTitles)
      .eq("category", "drills");

    const sectionsByTitle: Record<string, Record<string, string>> = {};
    for (const row of (allSections ?? []) as {
      report_title: string;
      section_heading: string;
      content: string;
    }[]) {
      if (!sectionsByTitle[row.report_title]) sectionsByTitle[row.report_title] = {};
      sectionsByTitle[row.report_title][row.section_heading] = row.content;
    }

    return topTitles.map((rawTitle) => {
      const sections = sectionsByTitle[rawTitle] ?? {};
      return {
        title: rawTitle.replace(/_ /g, ": "),
        setup:       findSection(sections, ["DRILL"]),
        key_focus:   findSection(sections, ["COACHING", "PRINCIPLES"]),
        progression: findSection(sections, ["SESSION", "DESIGN"]),
      };
    });
  } catch {
    return [];
  }
}
