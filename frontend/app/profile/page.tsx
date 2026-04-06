"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface TeamProfile {
  id: string;
  team_name: string;
  coach_philosophy: string;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<TeamProfile | null>(null);
  const [teamName, setTeamName] = useState("");
  const [coachPhilosophy, setCoachPhilosophy] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("team_profiles")
        .select("id, team_name, coach_philosophy")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (data) {
        setProfile(data);
        setTeamName(data.team_name ?? "");
        setCoachPhilosophy(data.coach_philosophy ?? "");
      }
      setLoading(false);
    }
    loadProfile();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError("");

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("Not authenticated.");
      setSaving(false);
      return;
    }

    let saveError;
    if (profile?.id) {
      const { error: err } = await supabase
        .from("team_profiles")
        .update({ team_name: teamName, coach_philosophy: coachPhilosophy })
        .eq("id", profile.id);
      saveError = err;
    } else {
      const { data, error: err } = await supabase
        .from("team_profiles")
        .insert({ team_name: teamName, coach_philosophy: coachPhilosophy, user_id: user.id })
        .select("id, team_name, coach_philosophy")
        .single();
      saveError = err;
      if (data) setProfile(data);
    }

    if (saveError) {
      setError(saveError.message);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-2xl mx-auto">

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Team Profile</h1>
          <p className="text-white/40 text-sm mt-1">
            Your team profile shapes every analysis and report the AI generates.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-white/30 text-sm">
            <div className="w-4 h-4 border-2 border-white/20 border-t-white/50 rounded-full animate-spin" />
            Loading profile…
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">

            {/* Team Name */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
                Team Name
              </label>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Exeter Chiefs RFC"
                className="w-full bg-white/10 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-white/40"
              />
            </div>

            {/* Coach Philosophy */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1">
                Coach Philosophy &amp; Playing Style
              </label>
              <p className="text-white/25 text-xs mb-3 leading-relaxed">
                Describe how your team plays — your attacking system, defensive structure, principles of play, and what you prioritise. The AI uses this as a lens when analysing clips and writing reports.
              </p>
              <textarea
                value={coachPhilosophy}
                onChange={(e) => setCoachPhilosophy(e.target.value)}
                rows={8}
                placeholder={`e.g. We run a wide attacking system built on quick ball and width. We want to play at pace and get the ball to the edges early. Defensively we blitz from the inside out and press hard on kick-offs. We prioritise collision dominance at the breakdown and want our 9 to move the ball in under 2 seconds. We're working on our ability to play through contact and our lineout set piece.`}
                className="w-full bg-white/10 border border-white/10 rounded-lg px-4 py-3 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/40 resize-none leading-relaxed"
              />
            </div>

            {/* Save */}
            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={saving}
                className={`px-6 py-2.5 rounded-lg font-semibold text-sm transition-all flex items-center gap-2 ${
                  saving
                    ? "bg-white/10 text-white/30 cursor-not-allowed"
                    : "bg-white text-black hover:brightness-90 cursor-pointer"
                }`}
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save Profile"
                )}
              </button>

              {saved && (
                <span className="text-green-400 text-sm font-medium">
                  Saved
                </span>
              )}

              {error && (
                <span className="text-red-400 text-sm">{error}</span>
              )}
            </div>

          </form>
        )}

      </div>
    </main>
  );
}
