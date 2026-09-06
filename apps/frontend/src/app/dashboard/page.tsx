'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Activity, FolderOpen, ShieldCheck, Users, TrendingUp,
  Clock, AlertCircle, CheckCircle, FileText, ShieldAlert,
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { DashboardGreetingHero } from '@/components/dashboard-greeting-hero';
import { RevealSection, SectionHeading } from '@/components/reveal-section';
import { api } from '@/contexts/auth-context';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#6b7280'];
const SEVERITY_COLORS: Record<string, string> = {
  Critical: '#ef4444',
  High: '#f97316',
  Medium: '#f59e0b',
  Low: '#3b82f6',
  Info: '#6b7280',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [vulnTrends, setVulnTrends] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetchStats();

    let interval: ReturnType<typeof setInterval> | undefined;
    api.get('/settings').then((res) => {
      const seconds = res.data?.settings?.appearance?.dashboardRefreshIntervalSeconds;
      if (seconds && seconds > 0) {
        interval = setInterval(fetchStats, seconds * 1000);
      }
    });
    return () => {
      if (interval) clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchStats = async () => {
    try {
      let statsRes;
      let vulnRes;
      if (user?.role === 'ADMIN' || user?.role === 'AVP') {
        [statsRes, vulnRes] = await Promise.all([
          api.get('/dashboard/admin'),
          api.get('/dashboard/vulnerabilities'),
        ]);
      } else if (user?.role === 'TEAM_LEAD') {
        [statsRes, vulnRes] = await Promise.all([
          api.get('/dashboard/team'),
          api.get('/dashboard/vulnerabilities'),
        ]);
      } else if (user?.role === 'TESTER') {
        // Testers only get vulnerability trends (no dedicated endpoint yet)
        vulnRes = await api.get('/dashboard/vulnerabilities');
      }
      setStats(statsRes?.data ?? null);
      setVulnTrends(vulnRes?.data ?? null);
    } catch (error: any) {
      if (error.response?.status === 401) {
        router.push('/login');
      } else {
        console.error('Failed to fetch stats:', error);
      }
    } finally {
      setLoading(false);
    }
  };

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'AVP';
  const pageTitle = isAdmin ? 'Admin Dashboard' : 'Dashboard';

  // Build project status chart data
  const projectStatusData = stats?.projects?.byStatus
    ? stats.projects.byStatus.map((s: any) => ({
        name: s.status.replace('_', ' '),
        value: s._count.status,
      }))
    : stats?.projectStats
    ? [
        { name: 'Not Started', value: stats.projectStats.notStarted || 0 },
        { name: 'In Progress', value: stats.projectStats.inProgress || 0 },
        { name: 'Awaiting Review', value: stats.projectStats.awaitingReview || 0 },
        { name: 'Completed', value: stats.projectStats.completed || 0 },
      ].filter(d => d.value > 0)
    : [];

  // Build severity chart data
  const severityData = vulnTrends?.bySeverity
    ? Object.entries(vulnTrends.bySeverity).map(([name, value]) => ({
        name,
        value: value as number,
        fill: SEVERITY_COLORS[name] || '#6b7280',
      }))
    : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardGreetingHero name={user?.fullName || user?.username || 'there'} pageTitle={pageTitle} />

      <div className="flex items-center justify-between">
        <p className="text-gray-400 text-sm">Overview of your VAPT operations</p>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm text-emerald-400 font-mono">SYSTEM ONLINE</span>
        </div>
      </div>

      {/* Overview */}
      <RevealSection>
        <SectionHeading>Overview</SectionHeading>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Projects"
            value={stats?.projects?.total ?? stats?.projectStats?.total ?? 0}
            icon={FolderOpen}
            color="emerald"
            href="/dashboard/projects"
            context="View all projects"
          />
          <StatCard
            title="Active Assessments"
            value={stats?.projectStats?.inProgress ?? 0}
            icon={Activity}
            color="cyan"
            href="/dashboard/projects?status=IN_PROGRESS"
            context="View projects in progress"
          />
          <StatCard
            title="Vulnerabilities"
            value={vulnTrends?.total ?? stats?.findings ?? 0}
            icon={ShieldCheck}
            color="amber"
            href="/dashboard/vulnerabilities"
            context="Browse vulnerability database"
          />
          <StatCard
            title="Team Members"
            value={stats?.users?.active ?? stats?.testerStats?.length ?? 0}
            icon={Users}
            color="violet"
            href={isAdmin ? '/dashboard/users' : undefined}
            context={isAdmin ? 'Manage team members' : 'Active team members'}
          />
        </div>
      </RevealSection>

      {/* Project Health */}
      <RevealSection delay={0.05}>
        <SectionHeading>Project Health</SectionHeading>
        <motion.div
          whileHover={{ y: -2 }}
          className="glass-card rounded-xl p-6"
        >
          <h2 className="text-lg font-semibold text-white mb-4">Projects by Status</h2>
          {projectStatusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={projectStatusData}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {projectStatusData.map((_: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-500 text-sm text-center py-12">No project data</p>
          )}
        </motion.div>
      </RevealSection>

      {/* Vulnerabilities */}
      <RevealSection delay={0.1}>
        <SectionHeading>Vulnerabilities</SectionHeading>
        <motion.div
          whileHover={{ y: -2 }}
          className="glass-card rounded-xl p-6"
        >
          <h2 className="text-lg font-semibold text-white mb-4">Findings by Severity</h2>
          {severityData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={severityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {severityData.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-500 text-sm text-center py-12">No findings data</p>
          )}
        </motion.div>
      </RevealSection>

      {/* Main Content Grid */}
      <RevealSection delay={0.15} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Team Breakdown (Admin / TL) */}
        <motion.div
          whileHover={{ y: -2 }}
          className="lg:col-span-2 glass-card rounded-xl p-6"
        >
          <h2 className="text-lg font-semibold text-white mb-4">
            {isAdmin ? 'All Projects' : "Team Breakdown"}
          </h2>
          {stats?.testerStats?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="px-4 py-2 text-sm font-medium text-gray-400">Tester</th>
                    <th className="px-4 py-2 text-sm font-medium text-gray-400">Active Projects</th>
                    <th className="px-4 py-2 text-sm font-medium text-gray-400">Completed</th>
                    <th className="px-4 py-2 text-sm font-medium text-gray-400">Pending Reviews</th>
                    <th className="px-4 py-2 text-sm font-medium text-gray-400">Total Findings</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.testerStats.map((t: any, i: number) => (
                    <tr key={i} className="border-b border-gray-700/50 hover:bg-white/5 transition-colors">
                      <td className="px-4 py-2 text-sm text-white">{t.username}</td>
                      <td className="px-4 py-2 text-sm text-cyan-400">{t.activeProjects}</td>
                      <td className="px-4 py-2 text-sm text-emerald-400">{t.completedProjects}</td>
                      <td className="px-4 py-2 text-sm text-yellow-400">{t.pendingReviews}</td>
                      <td className="px-4 py-2 text-sm text-white">{t.totalFindings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : stats?.projects?.byStatus ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {stats.projects.byStatus.map((s: any) => (
                <div key={s.status} className="p-4 rounded-lg bg-white/5 text-center">
                  <p className="text-2xl font-bold text-white">{s._count.status}</p>
                  <p className="text-xs text-gray-400 mt-1">{s.status.replace('_', ' ')}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No team data</p>
          )}
        </motion.div>

        {/* Quick Actions */}
        <motion.div
          whileHover={{ y: -2 }}
          className="glass-card rounded-xl p-6"
        >
          <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <QuickAction
              href="/dashboard/projects/new"
              icon={FolderOpen}
              label="New Project"
              description="Create a new assessment"
            />
            <QuickAction
              href="/dashboard/vulnerabilities"
              icon={ShieldCheck}
              label="Vuln Database"
              description="Browse vulnerability DB"
            />
            {(user?.role === 'ADMIN' || user?.role === 'AVP' || user?.role === 'TEAM_LEAD') && (
              <QuickAction
                href="/dashboard/vulnerabilities?tab=pending"
                icon={AlertCircle}
                label="Pending Approvals"
                description="Review pending vuln requests"
              />
            )}
            <QuickAction
              href="/dashboard/reports"
              icon={FileText}
              label="Reports"
              description="View generated reports"
            />
          </div>
        </motion.div>
      </RevealSection>

      {/* Activity */}
      {(isAdmin || user?.role === 'TEAM_LEAD') && <RecentActivity delay={0.2} />}
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color, href, context }: any) {
  const colorMap: any = {
    emerald: 'text-emerald-400 bg-emerald-500/10',
    cyan: 'text-cyan-400 bg-cyan-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
    violet: 'text-violet-400 bg-violet-500/10',
  };

  const card = (
    <motion.div
      whileHover={href ? { scale: 1.02, y: -2 } : undefined}
      className={`glass-card rounded-xl p-5 group ${href ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400">{title}</p>
          <p className="text-2xl font-bold text-white mt-1">{value}</p>
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorMap[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      {context && (
        <p className="text-xs text-gray-500 mt-3 h-0 opacity-0 group-hover:h-4 group-hover:opacity-100 transition-all duration-200 overflow-hidden">
          {context}
        </p>
      )}
    </motion.div>
  );

  return href ? <Link href={href}>{card}</Link> : card;
}

function QuickAction({ href, icon: Icon, label, description }: any) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-all group"
    >
      <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-500/20 transition-all">
        <Icon className="w-5 h-5 text-emerald-400" />
      </div>
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs text-gray-400">{description}</p>
      </div>
    </Link>
  );
}

function RecentActivity({ delay }: { delay?: number }) {
  const [activity, setActivity] = useState<any[]>([]);

  useEffect(() => {
    api.get('/dashboard/activity?limit=8')
      .then((res) => setActivity(res.data))
      .catch(() => setActivity([]));
  }, []);

  if (activity.length === 0) return null;

  return (
    <RevealSection delay={delay}>
      <SectionHeading>Activity</SectionHeading>
      <div className="glass-card rounded-xl p-6">
        <div className="space-y-3">
          {activity.map((log: any) => (
            <div key={log.id} className="flex items-start gap-3 pb-3 border-b border-gray-800 last:border-0 last:pb-0">
              <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 mt-0.5">
                <Clock className="w-4 h-4 text-gray-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-white">
                  <span className="font-medium">{log.actor?.username || 'System'}</span>{' '}
                  <span className="text-gray-400">{log.action.replace(/_/g, ' ').toLowerCase()}</span>
                  {log.targetType && <span className="text-gray-500"> · {log.targetType.toLowerCase()}</span>}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{new Date(log.timestamp).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </RevealSection>
  );
}
