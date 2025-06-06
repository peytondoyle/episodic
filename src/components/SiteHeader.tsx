"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const links = [
  { href: "/shows", label: "All Shows" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/search", label: "Search TMDB" },
];

export default function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="bg-black text-white p-4">
      <nav className="flex gap-6">
        {links.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              "text-white/80 hover:text-white transition",
              pathname === href && "font-bold underline"
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}