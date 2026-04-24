"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="flex flex-col min-h-full bg-[#0a0a0a]">

      {/* Top nav */}
      <header className="w-full border-b border-white/10">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div />
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span className="text-white/50 text-sm hidden sm:block truncate max-w-[200px]">
                  {user.email}
                </span>
                <button
                  onClick={handleLogout}
                  className="px-4 py-1.5 rounded-md border border-white/20 text-white/70 text-sm hover:border-white/40 hover:text-white transition-colors"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="px-4 py-1.5 rounded-md border border-white/20 text-white/70 text-sm hover:border-white/40 hover:text-white transition-colors"
                >
                  Login
                </Link>
                <Link
                  href="/signup"
                  className="px-4 py-1.5 rounded-md bg-white text-black text-sm font-semibold hover:brightness-90 transition-all"
                >
                  Get Started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex flex-col items-center justify-center flex-1 px-6 text-center py-24">
        <div className="max-w-2xl w-full">

          <h1 className="text-5xl font-bold text-white tracking-tight mb-3">
            BreakdownAI
          </h1>

          <p className="text-white/40 text-base font-normal mb-5 tracking-wide uppercase text-xs">
            Analysis with AI, delivered in plain English
          </p>

          <p className="text-white/60 text-lg mb-10 max-w-xl mx-auto leading-relaxed">
            Clip your match footage, run AI analysis on every sequence, and generate full attack, defence, and opposition scouting reports.
          </p>

          <Link
            href={user ? "/match-analysis/clipping" : "/signup"}
            className="inline-block px-6 py-3 rounded-md bg-white text-black text-sm font-semibold hover:brightness-90 transition-all"
          >
            Get Started
          </Link>

          {/* Steps */}
          <div className="mt-16 grid grid-cols-1 gap-2 text-left max-w-lg mx-auto">
            {[
              {
                step: "1",
                title: "Clip",
                desc: "Upload your match footage and mark in/out points to clip attack and defence sequences.",
              },
              {
                step: "2",
                title: "Analyse",
                desc: "The AI analyses each clip individually — identifying the system, tactical themes, and positives/work ons to generate actionable coaching insights.",
              },
              {
                step: "3",
                title: "Report",
                desc: "Generate a comprehensive attack/defence report covering system, tactics, and execution — pinpointing areas to address in training, fixing weaknesses and building on strengths.",
              },
              {
                step: "4",
                title: "Opposition Analysis",
                desc: "Clip and analyse opposition attack/defence sequences to generate a full scouting report on their system, tactics, strengths, and vulnerabilities — with clear intel on how to expose weaknesses and suppress their threats.",
              },
            ].map(({ step, title, desc }) => (
              <div key={step} className="flex gap-4 bg-transparent border border-white/10 rounded-md px-4 py-3">
                <span className="text-white/30 font-bold text-sm leading-none mt-0.5 w-4 shrink-0">{step}</span>
                <div>
                  <p className="text-white font-semibold text-sm">{title}</p>
                  <p className="text-white/60 text-sm mt-0.5 leading-snug">{desc}</p>
                </div>
              </div>
            ))}
          </div>

        </div>
      </main>

    </div>
  );
}
