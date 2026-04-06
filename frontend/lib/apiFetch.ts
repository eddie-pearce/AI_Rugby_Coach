import { createClient } from "@/lib/supabase/client";

/**
 * Drop-in replacement for `fetch` that automatically attaches the current
 * Supabase session token as `Authorization: Bearer <token>`.
 */
export async function apiFetch(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers = new Headers(init.headers);
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }

  return fetch(input, { ...init, headers });
}
