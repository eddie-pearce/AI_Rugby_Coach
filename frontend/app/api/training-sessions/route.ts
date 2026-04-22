import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

function makeServiceSupabase() {
  return createServiceClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
}

async function getAuthUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// GET /api/training-sessions?match_id=X (optional filter)
export async function GET(req: NextRequest) {
  const user_id = await getAuthUserId();
  if (!user_id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const match_id = req.nextUrl.searchParams.get("match_id");
  const supabase = makeServiceSupabase();

  let query = supabase
    .from("training_sessions")
    .select("*")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false });

  if (match_id) query = query.eq("match_id", match_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
