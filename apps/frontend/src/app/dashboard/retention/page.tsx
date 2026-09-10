'use client';

import { useEffect, useState } from 'react';
import { api } from '@/contexts/auth-context';
import { formatDate } from '@/lib/datetime';

type TrackerEntry = {
  projectId: string;
  projectName: string;
  completionDate: string;
  retentionPeriodDays: number;
  daysRemaining: number;
  scheduledDeletionDate: string;
};

export default function RetentionTrackerPage() {
  const [entries, setEntries] = useState<TrackerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/retention/tracker')
      .then((res) => setEntries(res.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-gray-400">Loading retention tracker…</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">Project Retention Tracker</h1>
        <p className="text-sm text-gray-400 mt-1">
          Completed projects are automatically deleted, along with their generated reports and issue log, once their retention period expires.
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="glass-card p-6 rounded-xl text-gray-400">No completed projects are pending retention.</div>
      ) : (
        <div className="glass-card rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="p-3 font-medium">Project</th>
                <th className="p-3 font-medium">Completion Date</th>
                <th className="p-3 font-medium">Retention Period</th>
                <th className="p-3 font-medium">Days Remaining</th>
                <th className="p-3 font-medium">Scheduled Deletion</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.projectId} className="border-t border-gray-800">
                  <td className="p-3 text-white">{e.projectName}</td>
                  <td className="p-3 text-gray-300">{formatDate(e.completionDate)}</td>
                  <td className="p-3 text-gray-300">{e.retentionPeriodDays} days</td>
                  <td className={`p-3 font-medium ${e.daysRemaining <= 30 ? 'text-amber-400' : 'text-cyan-400'}`}>
                    {e.daysRemaining} days
                  </td>
                  <td className="p-3 text-gray-300">{formatDate(e.scheduledDeletionDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
