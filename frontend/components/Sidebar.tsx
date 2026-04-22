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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0">
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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
    items: [
      {
        href: "/match-analysis/clipping",
        label: "Clipping",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
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
    label: "Opposition Analysis",
    base: "/opposition-analysis",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
    items: [
      {
        href: "/opposition-analysis/clipping",
        label: "Clipping",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
  },
];

const profileIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0">
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
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
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

  // Track which groups are expanded on desktop
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    nav.forEach((item) => {
      if (item.type === "group") {
        init[item.base] = false; // initialise closed; useEffect opens active one
      }
    });
    return init;
  });

  // Auto-expand the active group on navigation
  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      nav.forEach((item) => {
        if (item.type === "group" && pathname.startsWith(item.base)) {
          next[item.base] = true;
        }
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

  // Detect active group for the mobile secondary strip
  const activeGroup = nav.find(
    (item): item is NavGroup => item.type === "group" && pathname.startsWith(item.base)
  ) ?? null;

  return (
    <aside className="
      flex flex-col
      w-full lg:w-52 lg:shrink-0
      border-b lg:border-b-0 lg:border-r border-white/10
      lg:min-h-screen lg:sticky lg:top-0 lg:h-screen
    ">
      {/* ── Brand — desktop only ── */}
      <div className="hidden lg:flex items-center gap-2 px-5 py-6 mb-1">
        <span className="w-1.5 h-5 bg-white rounded-full shrink-0" />
        <span className="text-white font-bold text-base tracking-wide">BreakdownAI</span>
      </div>

      {/* ── Mobile primary bar ── */}
      <nav className="flex lg:hidden flex-row flex-1 gap-0.5 px-2 py-2">
        {nav.map((item) => {
          if (item.type === "link") {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex flex-col items-center gap-0.5
                  px-1 py-1.5 rounded-lg flex-1
                  text-[10px] font-medium transition-colors
                  ${active ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/5"}
                `}
              >
                {item.icon}
                <span className="leading-none">{item.label}</span>
              </Link>
            );
          }

          // Group: pressing navigates to first sub-item; shows active if under this base
          const groupActive = pathname.startsWith(item.base);
          return (
            <Link
              key={item.base}
              href={item.items[0].href}
              className={`
                flex flex-col items-center gap-0.5
                px-1 py-1.5 rounded-lg flex-1
                text-[10px] font-medium transition-colors
                ${groupActive ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/5"}
              `}
            >
              {item.icon}
              <span className="leading-none">{item.label === "Match Analysis" ? "Match" : item.label === "Opposition Analysis" ? "Opposition" : item.label}</span>
            </Link>
          );
        })}

        {/* Profile — mobile */}
        <Link
          href="/profile"
          className={`
            flex flex-col items-center gap-0.5
            px-1 py-1.5 rounded-lg flex-1
            text-[10px] font-medium transition-colors
            ${pathname === "/profile" ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/5"}
          `}
        >
          {profileIcon}
          <span className="leading-none">Profile</span>
        </Link>
      </nav>

      {/* ── Mobile secondary strip — sub-items of active group ── */}
      {activeGroup && (
        <div className="flex lg:hidden flex-row gap-1 px-3 pb-2">
          {activeGroup.items.map((sub) => {
            const active = pathname === sub.href;
            return (
              <Link
                key={sub.href}
                href={sub.href}
                className={`
                  flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all
                  ${active ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70 hover:bg-white/5"}
                `}
              >
                {sub.icon}
                {sub.label}
              </Link>
            );
          })}
        </div>
      )}

      {/* ── Desktop nav ── */}
      <nav className="hidden lg:flex flex-col flex-1 gap-0.5 px-3">
        {nav.map((item) => {
          if (item.type === "link") {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex flex-row items-center gap-3
                  px-3 py-2.5 rounded-lg
                  text-sm font-medium transition-colors
                  ${active ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/5"}
                `}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          }

          // Group
          const groupActive = pathname.startsWith(item.base);
          const isOpen = expanded[item.base] ?? groupActive;

          return (
            <div key={item.base}>
              {/* Group header button */}
              <button
                onClick={() => toggleGroup(item.base)}
                className={`
                  w-full flex flex-row items-center gap-3
                  px-3 py-2.5 rounded-lg
                  text-sm font-medium transition-colors
                  ${groupActive ? "text-white" : "text-white/50 hover:text-white hover:bg-white/5"}
                `}
              >
                {item.icon}
                <span className="flex-1 text-left">{item.label}</span>
                <Chevron open={isOpen} />
              </button>

              {/* Sub-items */}
              {isOpen && (
                <div className="ml-4 pl-3 border-l border-white/10 mt-0.5 mb-1 space-y-0.5">
                  {item.items.map((sub) => {
                    const active = pathname === sub.href;
                    return (
                      <Link
                        key={sub.href}
                        href={sub.href}
                        className={`
                          flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors
                          ${active ? "bg-white/10 text-white" : "text-white/40 hover:text-white hover:bg-white/5"}
                        `}
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

      {/* ── Profile — desktop only ── */}
      <div className="hidden lg:block px-3 mt-auto">
        <Link
          href="/profile"
          className={`
            flex flex-row items-center gap-3
            px-3 py-2.5 rounded-lg
            text-sm font-medium transition-colors
            ${pathname === "/profile" ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/5"}
          `}
        >
          {profileIcon}
          <span>Profile</span>
        </Link>
      </div>

      {/* ── User info + logout — desktop only ── */}
      {user && (
        <div className="hidden lg:flex flex-col gap-2 px-4 py-4 border-t border-white/10">
          <p className="text-white/40 text-xs truncate" title={user.email ?? ""}>
            {user.email}
          </p>
          <button
            onClick={handleLogout}
            className="text-white/40 text-xs hover:text-white transition-colors text-left"
          >
            Log out
          </button>
        </div>
      )}
    </aside>
  );
}
