'use client';

import Link from 'next/link';
import { Home } from 'lucide-react';

// A scanner line sweeps across on hover; pure CSS.
export function ScanButton({ href = '/dashboard', label = 'Return to Dashboard' }: { href?: string; label?: string }) {
  return (
    <Link
      href={href}
      className="group relative inline-flex items-center gap-2 overflow-hidden px-6 py-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-sm font-medium hover:bg-emerald-500/20 transition-colors"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1/3 -translate-x-full group-hover:translate-x-[300%] transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent motion-reduce:hidden"
      />
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-emerald-400/0 group-hover:bg-emerald-400/60 transition-colors" />
      <Home className="w-4 h-4 relative" />
      <span className="relative">{label}</span>
    </Link>
  );
}
