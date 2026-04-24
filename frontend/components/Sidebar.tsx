"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

// ─── Nav schema ───────────────────────────────────────────────────────────────

type SubItem = { href: string; label: string; icon?: React.ReactNode };
type NavLink = { type: "link"; href: string; label: string; icon: React.ReactNode };
type NavGroup = { type: "group"; label: string; icon: React.ReactNode; base: string; items: SubItem[] };
type NavItem = NavLink | NavGroup;

const nav: NavItem[] = [
  {
    type: "link",
    href: "/",
    label: "Home",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    type: "group",
    label: "Match Analysis",
    base: "/match-analysis",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
    items: [
      {
        href: "/match-analysis/clipping",
        label: "Clipping",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
            <circle cx="6" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <line x1="20" y1="4" x2="8.12" y2="15.88" />
            <line x1="14.47" y1="14.48" x2="20" y2="20" />
            <line x1="8.12" y1="8.12" x2="12" y2="12" />
          </svg>
        ),
      },
      {
        href: "/match-analysis/analysis",
        label: "Analysis",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        ),
      },
    ],
  },
  {
    type: "group",
    label: "Opposition",
    base: "/opposition-analysis",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
    items: [
      {
        href: "/opposition-analysis/clipping",
        label: "Clipping",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
            <circle cx="6" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <line x1="20" y1="4" x2="8.12" y2="15.88" />
            <line x1="14.47" y1="14.48" x2="20" y2="20" />
            <line x1="8.12" y1="8.12" x2="12" y2="12" />
          </svg>
        ),
      },
      {
        href: "/opposition-analysis/analysis",
        label: "Analysis",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        ),
      },
    ],
  },
  {
    type: "link",
    href: "/training",
    label: "Training",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
  },
];

const profileIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
);

// ─── Chevron ──────────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`w-3 h-3 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    nav.forEach((item) => {
      if (item.type === "group") init[item.base] = false;
    });
    return init;
  });

  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      nav.forEach((item) => {
        if (item.type === "group" && pathname.startsWith(item.base)) next[item.base] = true;
      });
      return next;
    });
  }, [pathname]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  function toggleGroup(base: string) {
    setExpanded((prev) => ({ ...prev, [base]: !prev[base] }));
  }

  const activeGroup = nav.find(
    (item): item is NavGroup => item.type === "group" && pathname.startsWith(item.base)
  ) ?? null;

  return (
    <aside
      className="
        flex flex-col
        w-full lg:w-52 lg:shrink-0
        border-b lg:border-b-0 lg:border-r
        lg:min-h-screen lg:sticky lg:top-0 lg:h-screen
      "
      style={{ borderColor: "var(--color-edge)", backgroundColor: "var(--color-bg)" }}
    >
      {/* ── Brand — desktop only ───────────────────────────────────────── */}
      <div className="hidden lg:flex items-center gap-2.5 px-4 py-5 mb-2">
        <div
          className="w-6 h-6 rounded flex items-center justify-center shrink-0"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
            <path d="M3 12 L8 4 L13 12 M5.5 9 L10.5 9" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span
          className="font-condensed font-700 text-[15px] tracking-wide"
          style={{ color: "var(--color-hi)", fontFamily: "var(--font-condensed)", fontWeight: 700, letterSpacing: "0.04em" }}
        >
          BREAKDOWNAI
        </span>
      </div>

      {/* ── Section label — desktop ────────────────────────────────────── */}
      <div className="hidden lg:block px-4 mb-1">
        <span className="label-caps">Navigation</span>
      </div>

      {/* ── Mobile primary bar ──────────────────────────────────────────── */}
      <nav className="flex lg:hidden flex-row flex-1 gap-0.5 px-2 py-2">
        {nav.map((item) => {
          if (item.type === "link") {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center gap-1 px-1 py-2 rounded-lg flex-1 text-[10px] font-semibold transition-colors"
                style={{
                  color: active ? "var(--color-accent)" : "var(--color-lo)",
                  backgroundColor: active ? "var(--color-accent-muted)" : "transparent",
                  fontFamily: "var(--font-condensed)",
                  letterSpacing: "0.04em",
                }}
              >
                {item.icon}
                <span className="leading-none uppercase">{item.label}</span>
              </Link>
            );
          }

          const groupActive = pathname.startsWith(item.base);
          return (
            <Link
              key={item.base}
              href={item.items[0].href}
              className="flex flex-col items-center gap-1 px-1 py-2 rounded-lg flex-1 text-[10px] font-semibold transition-colors"
              style={{
                color: groupActive ? "var(--color-accent)" : "var(--color-lo)",
                backgroundColor: groupActive ? "var(--color-accent-muted)" : "transparent",
                fontFamily: "var(--font-condensed)",
                letterSpacing: "0.04em",
              }}
            >
              {item.icon}
              <span className="leading-none uppercase">
                {item.label === "Match Analysis" ? "Match" : item.label === "Opposition Analysis" ? "Opp" : item.label}
              </span>
            </Link>
          );
        })}

        <Link
          href="/profile"
          className="flex flex-col items-center gap-1 px-1 py-2 rounded-lg flex-1 text-[10px] font-semibold transition-colors"
          style={{
            color: pathname === "/profile" ? "var(--color-accent)" : "var(--color-lo)",
            backgroundColor: pathname === "/profile" ? "var(--color-accent-muted)" : "transparent",
            fontFamily: "var(--font-condensed)",
            letterSpacing: "0.04em",
          }}
        >
          {profileIcon}
          <span className="leading-none uppercase">Profile</span>
        </Link>
      </nav>

      {/* ── Mobile secondary strip ───────────────────────────────────────── */}
      {activeGroup && (
        <div className="flex lg:hidden flex-row gap-1 px-3 pb-2">
          {activeGroup.items.map((sub) => {
            const active = pathname === sub.href;
            return (
              <Link
                key={sub.href}
                href={sub.href}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-semibold transition-all"
                style={{
                  color: active ? "var(--color-hi)" : "var(--color-lo)",
                  backgroundColor: active ? "var(--color-surface-up)" : "transparent",
                  fontFamily: "var(--font-condensed)",
                  letterSpacing: "0.04em",
                }}
              >
                {sub.icon}
                <span className="uppercase">{sub.label}</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* ── Desktop nav ─────────────────────────────────────────────────── */}
      <nav className="hidden lg:flex flex-col flex-1 gap-0.5 px-3 overflow-y-auto">
        {nav.map((item) => {
          if (item.type === "link") {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="relative flex flex-row items-center gap-2.5 px-3 py-2 rounded text-sm font-medium transition-colors"
                style={{
                  color: active ? "var(--color-hi)" : "var(--color-mid)",
                  backgroundColor: active ? "var(--color-surface-up)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!active) (e.currentTarget as HTMLElement).style.color = "var(--color-hi)";
                }}
                onMouseLeave={(e) => {
                  if (!active) (e.currentTarget as HTMLElement).style.color = "var(--color-mid)";
                }}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full"
                    style={{ backgroundColor: "var(--color-accent)" }}
                  />
                )}
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          }

          const groupActive = pathname.startsWith(item.base);
          const isOpen = expanded[item.base] ?? groupActive;

          return (
            <div key={item.base}>
              <button
                onClick={() => toggleGroup(item.base)}
                className="relative w-full flex flex-row items-center gap-2.5 px-3 py-2 rounded text-sm font-medium transition-colors text-left"
                style={{
                  color: groupActive ? "var(--color-hi)" : "var(--color-mid)",
                  backgroundColor: groupActive && !isOpen ? "var(--color-surface)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!groupActive) (e.currentTarget as HTMLElement).style.color = "var(--color-hi)";
                }}
                onMouseLeave={(e) => {
                  if (!groupActive) (e.currentTarget as HTMLElement).style.color = "var(--color-mid)";
                }}
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
                <Chevron open={isOpen} />
              </button>

              {isOpen && (
                <div
                  className="ml-5 pl-3 mt-0.5 mb-1 space-y-0.5 border-l"
                  style={{ borderColor: "var(--color-edge-up)" }}
                >
                  {item.items.map((sub) => {
                    const active = pathname === sub.href;
                    return (
                      <Link
                        key={sub.href}
                        href={sub.href}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded text-[13px] font-medium transition-colors"
                        style={{
                          color: active ? "var(--color-accent)" : "var(--color-mid)",
                          backgroundColor: active ? "var(--color-accent-muted)" : "transparent",
                        }}
                        onMouseEnter={(e) => {
                          if (!active) (e.currentTarget as HTMLElement).style.color = "var(--color-hi)";
                        }}
                        onMouseLeave={(e) => {
                          if (!active) (e.currentTarget as HTMLElement).style.color = "var(--color-mid)";
                        }}
                      >
                        {sub.icon}
                        <span>{sub.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* ── Profile — desktop ────────────────────────────────────────────── */}
      <div className="hidden lg:block px-3 mt-auto pt-2">
        <Link
          href="/profile"
          className="relative flex flex-row items-center gap-2.5 px-3 py-2 rounded text-sm font-medium transition-colors"
          style={{
            color: pathname === "/profile" ? "var(--color-hi)" : "var(--color-mid)",
            backgroundColor: pathname === "/profile" ? "var(--color-surface-up)" : "transparent",
          }}
          onMouseEnter={(e) => {
            if (pathname !== "/profile") (e.currentTarget as HTMLElement).style.color = "var(--color-hi)";
          }}
          onMouseLeave={(e) => {
            if (pathname !== "/profile") (e.currentTarget as HTMLElement).style.color = "var(--color-mid)";
          }}
        >
          {pathname === "/profile" && (
            <span
              className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full"
              style={{ backgroundColor: "var(--color-accent)" }}
            />
          )}
          {profileIcon}
          <span>Profile</span>
        </Link>
      </div>

      {/* ── User footer — desktop ────────────────────────────────────────── */}
      {user && (
        <div
          className="hidden lg:flex flex-col gap-1.5 px-4 py-3 mt-1 border-t"
          style={{ borderColor: "var(--color-edge)" }}
        >
          <p
            className="text-xs truncate"
            style={{ color: "var(--color-lo)", fontFamily: "var(--font-mono)", fontSize: "11px" }}
            title={user.email ?? ""}
          >
            {user.email}
          </p>
          <button
            onClick={handleLogout}
            className="text-xs text-left transition-colors"
            style={{ color: "var(--color-lo)", fontSize: "12px" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-mid)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-lo)"; }}
          >
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
