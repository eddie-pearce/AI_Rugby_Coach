"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    setConfirmed(true);
    setLoading(false);
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0a] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <span className="w-1.5 h-5 bg-white rounded-full shrink-0" />
          <span className="text-white font-bold text-sm tracking-wide">BreakdownAI</span>
        </div>

        <h1 className="text-white text-xl font-semibold text-center mb-1">
          Create an account
        </h1>
        <p className="text-white/40 text-sm text-center mb-8">
          Get started with BreakdownAI
        </p>

        {confirmed && (
          <div className="bg-white/10 border border-white/20 rounded-lg px-4 py-3 mb-6 text-center">
            <p className="text-white text-sm font-medium">Confirmation email sent by Supabase</p>
            <p className="text-white/50 text-xs mt-1">Check your inbox and click the link to complete signup.</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-white/40 text-xs mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="bg-white/10 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-white/40 w-full"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-white/40 text-xs mb-1.5">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="bg-white/10 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-white/40 w-full"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-white/40 text-xs mb-1.5">Confirm password</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="bg-white/10 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-white/40 w-full"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="bg-white text-black font-semibold rounded-lg py-2.5 text-sm hover:brightness-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-1"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="text-white/40 text-sm text-center mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-white hover:text-white/80 transition-colors">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
