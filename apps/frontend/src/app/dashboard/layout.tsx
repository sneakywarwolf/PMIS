'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { classifyTransition, TRANSITION_VARIANTS, TRANSITION_TIMING } from '@/lib/page-transitions';
import {
  LayoutDashboard,
  FolderKanban,
  FileText,
  ShieldAlert,
  Users,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Shield,
  Bell,
  UserCircle,
  ChevronDown,
  HelpCircle,
  Clock,
  Lock,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth, api } from '@/contexts/auth-context';
import { useBranding } from '@/contexts/branding-context';
import { useIdleTimer } from '@/hooks/use-idle-timer';
import { ThemeSelector } from '@/components/theme-selector';
import { isRouteAllowed } from '@/lib/rbac';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles: string[];
}

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  linkUrl?: string;
  relatedId?: string;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'AVP', 'TEAM_LEAD', 'TESTER'] },
  { label: 'Projects', href: '/dashboard/projects', icon: FolderKanban, roles: ['ADMIN', 'AVP', 'TEAM_LEAD', 'TESTER'] },
  { label: 'Reports', href: '/dashboard/reports', icon: FileText, roles: ['ADMIN', 'AVP', 'TEAM_LEAD', 'TESTER'] },
  { label: 'Vulnerabilities', href: '/dashboard/vulnerabilities', icon: ShieldAlert, roles: ['ADMIN', 'AVP', 'TEAM_LEAD', 'TESTER'] },
  { label: 'Quiz', href: '/dashboard/quiz', icon: HelpCircle, roles: ['ADMIN', 'AVP', 'TEAM_LEAD', 'TESTER'] },
  { label: 'Retention', href: '/dashboard/retention', icon: Clock, roles: ['ADMIN', 'AVP', 'TEAM_LEAD', 'TESTER'] },
  { label: 'Users', href: '/dashboard/users', icon: Users, roles: ['ADMIN'] },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings, roles: ['ADMIN'] },
];

const roleLabel = (role: string) => {
  switch (role) {
    case 'ADMIN': return 'Administrator';
    case 'AVP': return 'AVP';
    case 'TEAM_LEAD': return 'Team Lead';
    case 'TESTER': return 'Tester';
    default: return role;
  }
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, loading } = useAuth();
  const { primaryColor } = useBranding();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const prevPathnameRef = useRef(pathname);
  const transitionKind = classifyTransition(prevPathnameRef.current, pathname);
  const idleTimer = useIdleTimer(!!user);

  useEffect(() => {
    prevPathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user && !isRouteAllowed(pathname, user.role)) {
      router.replace(`/unauthorized?from=${encodeURIComponent(pathname)}`);
    }
  }, [user, pathname, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-cyber-bg flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;
  if (user.isForcePasswordChange) return <ForceChangePasswordGate />;
  if (!isRouteAllowed(pathname, user.role)) return null;

  const filteredNav = navItems.filter(item => item.roles.includes(user.role));

  return (
    <div className="min-h-screen bg-cyber-bg flex">
      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 72 : 256 }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        className="fixed left-0 top-0 h-screen bg-cyber-surface border-r border-cyber-border z-50"
      >
        <div className="h-full flex flex-col">
          {/* Logo */}
          <div className="h-16 flex items-center px-4 border-b border-cyber-border">
            <Shield className="w-8 h-8 shrink-0" style={{ color: primaryColor }} />
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="ml-3 font-bold text-white whitespace-nowrap"
              >
                STT
              </motion.span>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-4 px-2 space-y-1">
            {filteredNav.map((item) => {
              const isActive = item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <motion.div
                  key={item.href}
                  whileHover={{ scale: 1.03, x: 2 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                >
                  <Link
                    href={item.href}
                    className={`flex items-center px-3 py-2.5 rounded-lg transition-all duration-200 group border ${
                      isActive
                        ? 'border-transparent'
                        : 'border-transparent text-gray-400 hover:text-teal-300 hover:bg-teal-400/5 hover:backdrop-blur-md hover:border-teal-400/20 hover:shadow-lg hover:shadow-teal-500/10'
                    }`}
                    style={isActive ? {
                      backgroundColor: `${primaryColor}1a`,
                      color: primaryColor,
                      borderColor: `${primaryColor}33`,
                      boxShadow: `0 0 0 1px ${primaryColor}1a`,
                    } : undefined}
                  >
                    <item.icon className="w-5 h-5 shrink-0" style={isActive ? { color: primaryColor } : undefined} />
                    {!collapsed && (
                      <span className="ml-3 text-sm font-medium whitespace-nowrap">{item.label}</span>
                    )}
                  </Link>
                </motion.div>
              );
            })}
          </nav>

          {/* Bottom */}
          <div className="p-2 border-t border-cyber-border">
            {!collapsed && (
              <div className="px-3 py-2 mb-2">
                <p className="text-sm font-medium text-white truncate">{user.fullName || user.username}</p>
                <p className="text-xs text-emerald-400">{roleLabel(user.role)}</p>
              </div>
            )}
            
            <button
              onClick={async () => { await logout(); router.push('/login'); }}
              className="flex items-center w-full px-3 py-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
            >
              <LogOut className="w-5 h-5 shrink-0" />
              {!collapsed && <span className="ml-3 text-sm font-medium">Logout</span>}
            </button>

            <button
              onClick={() => setCollapsed(!collapsed)}
              className="mt-1 flex items-center justify-center w-full py-2 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-all"
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </motion.aside>

      {/* Main content */}
      <main
        className="flex-1 transition-all duration-300"
        style={{ marginLeft: collapsed ? 72 : 256 }}
      >
        {/* Top bar */}
        <div className="flex items-center justify-end px-6 pt-4 gap-3">
          <ThemeSelector />
          <NotificationBell />
          <UserDropdown user={user} logout={logout} router={router} />
        </div>

        {/* grid-stack: entering and exiting pages share one cell so they can
            overlap and cross-dissolve, instead of a hard cut between them */}
        <div className="grid">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={pathname}
              variants={TRANSITION_VARIANTS[transitionKind]}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={TRANSITION_TIMING}
              className="p-6"
              style={{ gridArea: '1 / 1' }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <AnimatePresence>
        {idleTimer.warning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 6 }}
              className="bg-gray-900 border border-amber-500/30 rounded-xl shadow-2xl p-6 w-full max-w-sm text-center"
            >
              <p className="text-white font-semibold mb-1">Still there?</p>
              <p className="text-sm text-gray-400 mb-4">
                You'll be logged out in {idleTimer.secondsRemaining}s due to inactivity.
              </p>
              <button
                onClick={idleTimer.stayActive}
                className="w-full py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-medium transition-colors"
              >
                Stay logged in
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NotificationBell() {
  const { user } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);

  const fetchNotifications = async () => {
    if (!user) return;
    try {
      const [notifRes, countRes] = await Promise.all([
        api.get('/notifications'),
        api.get('/notifications/count'),
      ]);
      setNotifications(notifRes.data);
      setUnreadCount(countRes.data.count);
    } catch (error: any) {
      if (error.response?.status === 401) {
        setNotifications([]);
        setUnreadCount(0);
      }
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const markAsRead = async (id: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {
      // silently fail
    }
  };

  const markAllAsRead = async () => {
    try {
      await api.put('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // silently fail
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen(!open); if (!open) fetchNotifications(); }}
        className="relative p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-all"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 bg-red-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0" onClick={() => setOpen(false)} />
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute right-0 mt-2 w-80 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <p className="text-sm font-medium text-white">Notifications</p>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-gray-500">
                  No notifications yet
                </div>
              ) : (
                notifications.map(n => (
                  <div
                    key={n.id}
                    className={`px-4 py-3 border-b border-gray-800 hover:bg-white/5 cursor-pointer transition-colors ${
                      !n.read ? 'bg-emerald-500/5' : ''
                    }`}
                    onClick={() => {
                      if (!n.read) markAsRead(n.id);
                      setOpen(false);
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm truncate ${!n.read ? 'font-medium text-white' : 'text-gray-300'}`}>
                          {n.title}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-[10px] text-gray-600 mt-1">{formatTime(n.createdAt)}</p>
                      </div>
                      {!n.read && (
                        <div className="mt-1 w-2 h-2 bg-emerald-400 rounded-full shrink-0" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </div>
  );
}

function UserDropdown({ user, logout, router }: { user: any; logout: () => Promise<void>; router: any }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-all"
      >
        <UserCircle className="w-6 h-6" />
        <ChevronDown className="w-3 h-3" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -6, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              style={{ transformOrigin: 'top right' }}
              className="absolute right-0 mt-2 w-48 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden"
            >
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.04 }}
                className="px-4 py-3 border-b border-gray-700"
              >
                <p className="text-sm font-medium text-white truncate">{user.fullName || user.username}</p>
                <p className="text-xs text-emerald-400">{roleLabel(user.role)}</p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
                <Link
                  href="/dashboard/profile"
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-all"
                  onClick={() => setOpen(false)}
                >
                  <UserCircle className="w-4 h-4" /> My Profile
                </Link>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
                <button
                  onClick={async () => { await logout(); router.push('/login'); }}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-300 hover:bg-red-500/10 hover:text-red-400 transition-all"
                >
                  <LogOut className="w-4 h-4" /> Logout
                </button>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function ForceChangePasswordGate() {
  const { logout, refreshUser } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' });
  const [visibility, setVisibility] = useState({ new: false, confirm: false });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.newPassword !== form.confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    if (form.newPassword.length < 14) {
      setError('Password must be at least 14 characters');
      return;
    }
    setSaving(true);
    try {
      // No current password required here — this is a forced change (new
      // account or admin-issued temp password), and the user already
      // proved possession of it by logging in with it.
      await api.post('/auth/change-password', {
        newPassword: form.newPassword,
      });
      await refreshUser();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Password change failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-cyber-bg flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-cyber-surface border border-cyber-border rounded-2xl p-8"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
            <Lock className="w-5 h-5 text-amber-400" />
          </div>
          <h1 className="text-lg font-semibold text-white">Password Change Required</h1>
        </div>
        <p className="text-sm text-gray-400 mb-6">
          For security, you must set a new password before continuing.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {(['new', 'confirm'] as const).map((field) => {
            const key = field === 'new' ? 'newPassword' : 'confirmPassword';
            const label = field === 'new' ? 'New Password' : 'Confirm New Password';
            return (
              <div key={field}>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
                <div className="relative">
                  <input
                    type={visibility[field] ? 'text' : 'password'}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    required
                    className="w-full px-3 py-2 pr-10 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setVisibility({ ...visibility, [field]: !visibility[field] })}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    {visibility[field] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            );
          })}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Updating...' : 'Change Password'}
          </button>

          <button
            type="button"
            onClick={async () => { await logout(); router.push('/login'); }}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Log out instead
          </button>
        </form>
      </motion.div>
    </div>
  );
}
