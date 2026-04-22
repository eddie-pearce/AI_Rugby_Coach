/**
 * Format a clip analysis_output for display.
 * Handles the new JSON format ({intent, what_worked, what_didnt_work})
 * and falls back to rendering raw text for legacy clips.
 */
export function formatAnalysisOutput(raw: string): string {
  try {
    const clean = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const data = JSON.parse(clean);
    if (typeof data.intent === "string") {
      const lines: string[] = [];

      lines.push("INTENT");
      lines.push(data.intent);
      lines.push("");

      lines.push("WHAT WORKED");
      if (Array.isArray(data.what_worked) && data.what_worked.length > 0) {
        data.what_worked.forEach((item: string) => lines.push(`• ${item}`));
      } else {
        lines.push("Nothing significant to note.");
      }
      lines.push("");

      lines.push("WHAT DIDN'T WORK");
      if (Array.isArray(data.what_didnt_work) && data.what_didnt_work.length > 0) {
        data.what_didnt_work.forEach((item: string) => lines.push(`• ${item}`));
      } else {
        lines.push("Nothing significant to note.");
      }

      return lines.join("\n");
    }
  } catch {
    // Not JSON — return raw text as-is
  }
  return raw;
}
