'use client';

import { useAuth } from '@/contexts/auth-context';

export default function SettingsPage() {
  const { user } = useAuth();

  if (user?.role !== 'ADMIN') {
    return (
      <div className="text-center py-12">
        <p className="text-red-400">Access denied. Admin privileges required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">System Settings</h1>
        <p className="text-gray-400 text-sm mt-1">Configure platform settings and security policies</p>
      </div>

      <div className="glass-card rounded-xl p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">Security Configuration</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-lg bg-white/5">
              <div>
                <p className="text-sm font-medium text-white">Password Policy</p>
                <p className="text-xs text-gray-400">Minimum 14 characters with complexity requirements</p>
              </div>
              <span className="px-2 py-1 rounded-full text-xs bg-emerald-500/10 text-emerald-400">Active</span>
            </div>
            <div className="flex items-center justify-between p-4 rounded-lg bg-white/5">
              <div>
                <p className="text-sm font-medium text-white">Account Lockout</p>
                <p className="text-xs text-gray-400">5 failed attempts = 15min lockout</p>
              </div>
              <span className="px-2 py-1 rounded-full text-xs bg-emerald-500/10 text-emerald-400">Active</span>
            </div>
            <div className="flex items-center justify-between p-4 rounded-lg bg-white/5">
              <div>
                <p className="text-sm font-medium text-white">Rate Limiting</p>
                <p className="text-xs text-gray-400">100 req/min general, 10 req/min auth</p>
              </div>
              <span className="px-2 py-1 rounded-full text-xs bg-emerald-500/10 text-emerald-400">Active</span>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-700 pt-6">
          <h2 className="text-lg font-semibold text-white mb-4">Session Configuration</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-white/5">
              <p className="text-sm font-medium text-white">Access Token Expiry</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1">15 minutes</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5">
              <p className="text-sm font-medium text-white">Refresh Token Expiry</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1">7 days</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
