"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  {
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
    href: "/clipping",
    label: "Clipping",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0">
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <line x1="20" y1="4" x2="8.12" y2="15.88" />
        <line x1="14.47" y1="14.48" x2="20" y2="20" />
        <line x1="8.12" y1="8.12" x2="12" y2="12" />
      </svg>
    ),
  },
  {
    href: "/analysis",
    label: "Analysis",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    href: "/attack",
    label: "Attack",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0">
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    ),
  },
  {
    href: "/defence",
    label: "Defence",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="
      flex flex-row lg:flex-col
      w-full lg:w-52 lg:shrink-0
      border-b lg:border-b-0 lg:border-r border-white/10
      lg:min-h-screen lg:sticky lg:top-0 lg:h-screen
    ">
      {/* App name — desktop only */}
      <div className="hidden lg:flex items-center gap-2 px-5 py-6 mb-1">
        <span className="w-1.5 h-5 bg-amber rounded-full shrink-0" />
        <span className="text-white font-bold text-sm tracking-wide">AI Rugby Coach</span>
      </div>

      <nav className="flex flex-row lg:flex-col flex-1 gap-1 px-3 py-2 lg:py-0 lg:px-3">
        {nav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex flex-col lg:flex-row items-center lg:items-center gap-1 lg:gap-3
                px-2 lg:px-3 py-2 lg:py-2.5
                rounded-lg flex-1 lg:flex-none
                text-xs lg:text-sm font-medium transition-colors
                ${active
                  ? "bg-amber/10 text-amber"
                  : "text-white/50 hover:text-white hover:bg-white/5"
                }
              `}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
