'use client';

import Link from 'next/link';
import { ShieldOff, Home } from 'lucide-react';

export default function UnauthorizedError() {
  return (
    <div className="min-h-screen bg-cyber-bg flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-6 w-20 h-20 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
          <ShieldOff className="w-9 h-9 text-red-400" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Access Restricted</h1>
        <p className="text-gray-400 text-sm mb-8">You don't have permission to view this page.</p>
        <Link href="/dashboard" className="flex items-center gap-1.5 justify-center text-xs text-gray-500 hover:text-gray-300 transition-colors">
          <Home className="w-3.5 h-3.5" /> Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
