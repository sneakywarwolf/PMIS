'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Settings as SettingsIcon, Palette, LayoutGrid, ShieldCheck, Paperclip, Bell, Calendar, ListOrdered, ArrowUp, ArrowDown, GripVertical, Save, Loader2, Clock, ServerCog, Egg, KeyRound } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/contexts/auth-context';
import { useToast } from '@/components/toast-provider';
import { LiveMonitor } from '@/components/easter-egg/live-monitor';
import { formatDateTime } from '@/lib/datetime';
import { THEMES } from '@/lib/themes';
import { PillSwitch } from '@/components/pill-switch';
import { useBranding } from '@/contexts/branding-context';

const ROLE_LABELS: Record<string, string> = { ADMIN: 'Admin', AVP: 'AVP', TEAM_LEAD: 'Team Lead', TESTER: 'Tester' };

const TABS = [
  { id: 'general', label: 'General & Branding', icon: Palette },
  { id: 'appearance', label: 'Appearance', icon: LayoutGrid },
  { id: 'workflow', label: 'Workflow', icon: SettingsIcon },
  { id: 'security', label: 'Security & Sessions', icon: ShieldCheck },
  { id: 'attachments', label: 'Attachments', icon: Paperclip },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'rbac', label: 'RBAC', icon: KeyRound },
  { id: 'formatting', label: 'Formatting', icon: Calendar },
  { id: 'issueLog', label: 'Issue Log Parameters', icon: ListOrdered },
  { id: 'system', label: 'System', icon: ServerCog },
  { id: 'easterEgg', label: 'Easter Egg', icon: Egg },
];

const inputCls = 'w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm text-white';
const labelCls = 'block text-sm text-gray-300 mb-1';
const hintCls = 'text-xs text-gray-500 mt-1';

export default function SettingsPage() {
  const { user } = useAuth();

  if (user?.role !== 'ADMIN') {
    return (
      <div className="text-center py-12">
        <p className="text-red-400">Access denied. Admin privileges required.</p>
      </div>
    );
  }

  return <SettingsContent />;
}

function SettingsContent() {
  const toast = useToast();
  const { refreshSettings } = useBranding();
  const [settings, setSettings] = useState<any>(null);
  // Lists from the server: every file format PMIS accepts, and every notification it sends.
  const [catalog, setCatalog] = useState<{ attachmentFormats: any; notificationTypes: any[]; permissionCatalog: { groups: string[]; permissions: any[] } }>({ attachmentFormats: { purposes: [], formats: [] }, notificationTypes: [], permissionCatalog: { groups: [], permissions: [] } });
  const [meta, setMeta] = useState<{ updatedAt: string | null; updatedById: string | null }>({ updatedAt: null, updatedById: null });
  const [history, setHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('general');
  const [saving, setSaving] = useState(false);

  const fetchSettings = async () => {
    const res = await api.get('/settings');
    setSettings(res.data.settings);
    setCatalog({ attachmentFormats: res.data.attachmentFormats ?? { purposes: [], formats: [] }, notificationTypes: res.data.notificationTypes ?? [], permissionCatalog: res.data.permissionCatalog ?? { groups: [], permissions: [] } });
    setMeta({ updatedAt: res.data.updatedAt, updatedById: res.data.updatedById });
  };

  const fetchHistory = async () => {
    try {
      const res = await api.get('/settings/history');
      setHistory(res.data);
    } catch {
      setHistory([]);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchHistory();
  }, []);

  const setCategory = (category: string, patch: any) => {
    setSettings((prev: any) => ({ ...prev, [category]: { ...prev[category], ...patch } }));
  };

  const saveCategory = async (category: string) => {
    setSaving(true);
    try {
      // The Workflow tab also displays Retention & Deletion fields, which are
      // stored under the "system" category — save both together so those
      // edits aren't silently dropped.
      const patch = category === 'workflow'
        ? { workflow: settings.workflow, system: settings.system }
        : { [category]: settings[category] };
      await api.put('/settings', patch);
      toast(`${TABS.find((t) => t.id === category)?.label} settings saved`);
      fetchSettings();
      fetchHistory();
      refreshSettings();
    } catch (error: any) {
      toast(error.response?.data?.message || 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Application Settings</h1>
        <p className="text-gray-400 text-sm mt-1">Configure platform-wide behavior, branding, and policies</p>
        {meta.updatedAt && (
          <p className="text-xs text-gray-500 mt-1">Last updated {formatDateTime(meta.updatedAt)}</p>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === tab.id ? 'bg-emerald-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:text-white'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="glass-card rounded-xl p-6">
        {activeTab === 'general' && <GeneralTab settings={settings} setCategory={setCategory} />}
        {activeTab === 'appearance' && <AppearanceTab settings={settings} setCategory={setCategory} />}
        {activeTab === 'workflow' && <WorkflowTab settings={settings} setCategory={setCategory} />}
        {activeTab === 'security' && <SecurityTab settings={settings} setCategory={setCategory} />}
        {activeTab === 'attachments' && <AttachmentsTab settings={settings} setCategory={setCategory} catalog={catalog.attachmentFormats} />}
        {activeTab === 'rbac' && <RbacTab settings={settings} setCategory={setCategory} catalog={catalog.permissionCatalog} />}
        {activeTab === 'notifications' && <NotificationsTab settings={settings} setCategory={setCategory} types={catalog.notificationTypes} />}
        {activeTab === 'formatting' && <FormattingTab settings={settings} setCategory={setCategory} />}
        {activeTab === 'issueLog' && <IssueLogTab settings={settings} setCategory={setCategory} />}
      {activeTab === 'system' && <SystemTab settings={settings} setCategory={setCategory} />}
        {activeTab === 'easterEgg' && <EasterEggTab settings={settings} setCategory={setCategory} />}

        <div className="flex justify-end pt-6 mt-6 border-t border-gray-700">
          <button
            onClick={() => saveCategory(activeTab)}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save {TABS.find((t) => t.id === activeTab)?.label}
          </button>
        </div>
      </motion.div>

      {history.length > 0 && (
        <div className="glass-card rounded-xl p-6">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" /> Settings Change History
          </h2>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {history.map((log: any) => (
              <div key={log.id} className="flex items-start justify-between text-xs p-2 rounded bg-white/5">
                <div>
                  <span className="text-white font-medium">{log.actor?.fullName || log.actor?.username || 'Deleted user'}</span>
                  {log.actor?.fullName && <span className="text-gray-500"> @{log.actor.username}</span>}
                  {log.actor?.role && <span className="text-gray-500"> ({ROLE_LABELS[log.actor.role] || log.actor.role})</span>}
                  <span className="text-gray-400"> updated settings</span>
                  {log.details?.changed && (
                    <p className="text-gray-500 mt-0.5">{Object.keys(log.details.changed).join(', ')}</p>
                  )}
                </div>
                <span className="text-gray-500 shrink-0 ml-3">{formatDateTime(log.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const MAX_IMAGE_BYTES = 150 * 1024;

// Upload (stored in the settings as a data URL, so no extra file storage is needed) or a path on this site.
function ImageField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint: string }) {
  const toast = useToast();
  const pick = (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon)$/.test(file.type)) { toast('Use a PNG, JPEG, GIF, WebP or ICO image', 'error'); return; }
    if (file.size > MAX_IMAGE_BYTES) { toast('Image must be 150 KB or smaller', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded bg-gray-800/50 border border-gray-700 flex items-center justify-center overflow-hidden shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {value ? <img src={value} alt="" className="max-w-full max-h-full object-contain" /> : <span className="text-[10px] text-gray-600">none</span>}
        </div>
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/x-icon" aria-label={`${label} file`} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} className="text-xs text-gray-400 min-w-0" />
        {value && <button type="button" onClick={() => onChange('')} className="text-xs text-red-400 shrink-0">Remove</button>}
      </div>
      <p className={hintCls}>{hint} PNG, JPEG, GIF, WebP or ICO, up to 150 KB.</p>
    </div>
  );
}

function GeneralTab({ settings, setCategory }: any) {
  const g = settings.general;
  const b = settings.branding;
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-white mb-3">Application Identity</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Application Name</label>
            <input value={g.appName} onChange={(e) => setCategory('general', { appName: e.target.value })} className={inputCls} />
          </div>
          <ImageField label="Logo" value={g.logoUrl} onChange={(v) => setCategory('general', { logoUrl: v })} hint="Shown in the sidebar and on the login page." />
          <ImageField label="Favicon" value={g.faviconUrl} onChange={(v) => setCategory('general', { faviconUrl: v })} hint="Shown in the browser tab." />
        </div>
      </div>

      <div className="border-t border-gray-700 pt-6">
        <h3 className="text-sm font-medium text-white mb-3">Branding & Role Accent Colors</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Primary Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={b.primaryColor} onChange={(e) => setCategory('branding', { primaryColor: e.target.value })} className="w-10 h-10 rounded cursor-pointer bg-transparent" />
              <input value={b.primaryColor} onChange={(e) => setCategory('branding', { primaryColor: e.target.value })} className={inputCls} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          {Object.keys(b.roleAccentColors).map((role) => (
            <div key={role}>
              <label className={labelCls}>{role.replace('_', ' ')}</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={b.roleAccentColors[role]}
                  onChange={(e) => setCategory('branding', { roleAccentColors: { ...b.roleAccentColors, [role]: e.target.value } })}
                  className="w-9 h-9 rounded cursor-pointer bg-transparent shrink-0"
                />
                <span className="text-xs text-gray-400 font-mono">{b.roleAccentColors[role]}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 p-4 rounded-lg bg-gray-800/30 border border-gray-700">
          <p className="text-xs text-gray-500 mb-2">Live Preview</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ backgroundColor: b.primaryColor }}>{g.appName}</span>
            {Object.entries(b.roleAccentColors).map(([role, color]) => (
              <span key={role} className="px-2 py-1 rounded text-xs font-medium text-white" style={{ backgroundColor: color as string }}>{role}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AppearanceTab({ settings, setCategory }: any) {
  const a = settings.appearance;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="md:col-span-2">
        <label className={labelCls}>Default Theme</label>
        <p className={hintCls + ' mb-2 mt-0'}>Applies to every user unless they pick a personal theme from the header.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {THEMES.map((t) => {
            const selected = a.defaultTheme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setCategory('appearance', { defaultTheme: t.id })}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-sm transition-colors ${
                  selected ? 'border-emerald-500 bg-emerald-500/10 text-white' : 'border-gray-700 bg-gray-800/50 text-gray-300 hover:border-gray-600'
                }`}
              >
                <span className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/10" style={{ backgroundColor: t.swatch }} />
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <label className={labelCls}>Table Density</label>
        <select value={a.tableDensity} onChange={(e) => setCategory('appearance', { tableDensity: e.target.value })} className={inputCls}>
          <option value="compact">Compact</option>
          <option value="comfortable">Comfortable</option>
          <option value="spacious">Spacious</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>Dashboard Refresh Interval (seconds)</label>
        <input type="number" min={5} max={3600} value={a.dashboardRefreshIntervalSeconds} onChange={(e) => setCategory('appearance', { dashboardRefreshIntervalSeconds: parseInt(e.target.value) || 0 })} className={inputCls} />
        <p className={hintCls}>Allowed range: 5–3600 seconds</p>
      </div>
      <div>
        <label className={labelCls}>Default Pagination Size</label>
        <input type="number" min={5} max={200} value={a.paginationDefault} onChange={(e) => setCategory('appearance', { paginationDefault: parseInt(e.target.value) || 0 })} className={inputCls} />
        <p className={hintCls}>Allowed range: 5–200 rows per page</p>
      </div>
    </div>
  );
}

function TagListEditor({ label, values, onChange, hint }: { label: string; values: string[]; onChange: (v: string[]) => void; hint?: string }) {
  const [draft, setDraft] = useState('');
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="flex flex-wrap gap-2 mb-2">
        {values.map((v, i) => (
          <span key={i} className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-300">
            {v}
            <button type="button" onClick={() => onChange(values.filter((_, idx) => idx !== i))} className="text-gray-500 hover:text-red-400">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              e.preventDefault();
              onChange([...values, draft.trim()]);
              setDraft('');
            }
          }}
          placeholder="Type and press Enter"
          className={inputCls}
        />
      </div>
      {hint && <p className={hintCls}>{hint}</p>}
    </div>
  );
}

function WorkflowTab({ settings, setCategory }: any) {
  const w = settings.workflow;
  const sys = settings.system;
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-white mb-3">Severity Labels & Colors</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.keys(w.severityLabels).map((sev) => (
            <div key={sev} className="flex items-center gap-2">
              <input
                type="color"
                value={w.severityColors[sev]}
                onChange={(e) => setCategory('workflow', { severityColors: { ...w.severityColors, [sev]: e.target.value } })}
                className="w-9 h-9 rounded cursor-pointer bg-transparent shrink-0"
              />
              <input
                value={w.severityLabels[sev]}
                onChange={(e) => setCategory('workflow', { severityLabels: { ...w.severityLabels, [sev]: e.target.value } })}
                className={inputCls}
                placeholder={sev}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-gray-700 pt-6">
        <h3 className="text-sm font-medium text-white mb-3">Retention &amp; Deletion</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Attachment Retention Period (days)</label>
            <input type="number" min={1} max={3650} value={sys.attachmentRetentionDays} onChange={(e) => setCategory('system', { attachmentRetentionDays: parseInt(e.target.value) || 0 })} className={inputCls} />
            <p className={hintCls}>Allowed range: 1–3650 days. PoC attachments on findings older than this are automatically deleted.</p>
          </div>
          <div>
            <label className={labelCls}>Project Retention Period (days)</label>
            <input type="number" min={1} max={3650} value={sys.projectRetentionDays} onChange={(e) => setCategory('system', { projectRetentionDays: parseInt(e.target.value) || 0 })} className={inputCls} />
            <p className={hintCls}>Allowed range: 1–3650 days. Countdown starts when a project becomes Completed; the project, its generated reports, and issue log are then automatically deleted.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SecurityTab({ settings, setCategory }: any) {
  const s = settings.security;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label className={labelCls}>Session Timeout (minutes)</label>
        <input type="number" min={1} max={1440} value={s.sessionTimeoutMinutes} onChange={(e) => setCategory('security', { sessionTimeoutMinutes: parseInt(e.target.value) || 0 })} className={inputCls} />
        <p className={hintCls}>Allowed range: 1–1440 minutes. Applies to new logins and access-token refreshes.</p>
      </div>
      <div>
        <label className={labelCls}>Inactivity Behavior</label>
        <select value={s.inactivityAction} onChange={(e) => setCategory('security', { inactivityAction: e.target.value })} className={inputCls}>
          <option value="logout">Auto Logout</option>
          <option value="warn">Warn Only</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>Password Minimum Length</label>
        <input type="number" min={8} max={64} value={s.passwordMinLength} onChange={(e) => setCategory('security', { passwordMinLength: parseInt(e.target.value) || 0 })} className={inputCls} />
        <p className={hintCls}>Allowed range: 8–64 characters. Enforced on password change and new-user creation.</p>
      </div>
      <div className="flex items-center gap-3 pt-6">
        <input
          type="checkbox"
          id="passwordComplexity"
          checked={s.passwordRequireComplexity}
          onChange={(e) => setCategory('security', { passwordRequireComplexity: e.target.checked })}
          className="w-4 h-4 accent-emerald-500"
        />
        <label htmlFor="passwordComplexity" className="text-sm text-gray-300">Require complexity (upper/lower/number/symbol)</label>
      </div>
    </div>
  );
}

function AttachmentsTab({ settings, setCategory, catalog }: any) {
  const sizes: Record<string, number> = settings.attachments.maxSizeMb ?? {};
  const setSize = (key: string, value: number) => setCategory('attachments', { maxSizeMb: { ...sizes, [key]: value } });
  return (
    <div className="space-y-6">
      <p className={hintCls}>
        Every file format PMIS accepts, with the largest file allowed for it. A change applies to the next upload.
        Each format has its own highest value; files are also checked by their real content, not only their name.
      </p>
      {catalog.purposes.map((purpose: any) => (
        <div key={purpose.id} className="rounded-lg border border-gray-800 p-4">
          <h3 className="text-sm font-semibold text-white">{purpose.label}</h3>
          <p className="text-xs text-gray-500 mt-0.5 mb-3">{purpose.description}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {catalog.formats.filter((f: any) => f.purpose === purpose.id).map((f: any) => (
              <div key={f.key} className="flex items-center justify-between gap-3 rounded bg-white/5 px-3 py-2">
                <label htmlFor={`size-${f.key}`} className="text-sm text-gray-300">{f.label}</label>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    id={`size-${f.key}`}
                    type="number"
                    min={1}
                    max={f.maxMb}
                    step={1}
                    value={sizes[f.key] ?? f.defaultMb}
                    onChange={(e) => setSize(f.key, parseInt(e.target.value) || 0)}
                    className={`${inputCls} !w-24 text-right`}
                  />
                  <span className="text-xs text-gray-500 w-24 whitespace-nowrap">MB (max {f.maxMb})</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const ROLE_COLUMNS: { role: string; label: string }[] = [
  { role: 'AVP', label: 'AVP' },
  { role: 'TEAM_LEAD', label: 'Team Lead' },
  { role: 'TESTER', label: 'Tester' },
];

function NotificationsTab({ settings, setCategory, types }: any) {
  const rules: Record<string, Record<string, boolean>> = settings.notifications.roleRules ?? {};
  const on = (type: string, role: string) => rules[type]?.[role] !== false;
  const toggle = (type: string, role: string, next: boolean) =>
    setCategory('notifications', { roleRules: { ...rules, [type]: { AVP: on(type, 'AVP'), TEAM_LEAD: on(type, 'TEAM_LEAD'), TESTER: on(type, 'TESTER'), [role]: next } } });
  return (
    <div className="space-y-4">
      <p className={hintCls}>
        Choose which notifications each role receives. Admins always receive every notification and this cannot be changed.
        Switching a type off stops it being created for that role from then on; notifications already sent stay.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-gray-800">
              <th className="py-2 pr-4 font-medium">Notification</th>
              <th className="py-2 px-3 font-medium text-center">Admin</th>
              {ROLE_COLUMNS.map((c) => <th key={c.role} className="py-2 px-3 font-medium text-center">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {types.map((n: any) => (
              <tr key={n.type} className="border-b border-gray-800/60 align-top">
                <td className="py-3 pr-4">
                  <p id={`notif-${n.type}`} className="text-white">{n.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5 max-w-xl">{n.description}</p>
                </td>
                <td className="py-3 px-3">
                  <div className="flex justify-center" title="Admins always receive every notification">
                    <PillSwitch checked disabled onChange={() => undefined} ariaLabel={`${n.label}: Admin (always on)`} />
                  </div>
                </td>
                {ROLE_COLUMNS.map((c) => (
                  <td key={c.role} className="py-3 px-3">
                    <div className="flex justify-center">
                      <PillSwitch checked={on(n.type, c.role)} onChange={(v) => toggle(n.type, c.role, v)} ariaLabel={`${n.label}: ${c.label}`} />
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RbacTab({ settings, setCategory, catalog }: any) {
  const matrix: Record<string, Record<string, boolean>> = settings.rbac?.permissions ?? {};
  const [query, setQuery] = useState('');
  const on = (key: string, role: string, def: boolean) => (typeof matrix[key]?.[role] === 'boolean' ? matrix[key][role] : def);
  const toggle = (def: any, role: string, next: boolean) =>
    setCategory('rbac', {
      permissions: {
        ...matrix,
        [def.key]: { AVP: on(def.key, 'AVP', def.defaults.AVP), TEAM_LEAD: on(def.key, 'TEAM_LEAD', def.defaults.TEAM_LEAD), TESTER: on(def.key, 'TESTER', def.defaults.TESTER), [role]: next },
      },
    });
  const resetAll = () =>
    setCategory('rbac', { permissions: Object.fromEntries(catalog.permissions.map((p: any) => [p.key, { ...p.defaults }])) });
  const q = query.trim().toLowerCase();
  const matches = (p: any) => !q || `${p.label} ${p.description} ${p.group}`.toLowerCase().includes(q);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className={`${hintCls} max-w-2xl`}>
          Choose which roles may use each feature. Admins can always use every feature and this cannot be changed. A switch
          decides whether the role may use the feature at all; what a role can see of other people&rsquo;s data is still limited
          to their own projects (Testers) or team (Team Leads, AVPs), as before. Changes apply to everyone once saved. The
          Settings panel is not listed: it is only ever available to Admins.
        </p>
        <div className="flex items-center gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search features" aria-label="Search features" className={`${inputCls} !w-56`} />
          <button type="button" onClick={resetAll} className="px-3 py-2 rounded-lg bg-gray-700/60 hover:bg-gray-700 text-xs text-gray-200 whitespace-nowrap">Reset to defaults</button>
        </div>
      </div>
      {catalog.permissions.length === 0 && (
        <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          The server did not send the list of features. This usually means the backend is older than this screen: update
          and restart the backend (and the frontend) to the same release, then reload this page.
        </p>
      )}
      {catalog.groups.map((group: string) => {
        const rows = catalog.permissions.filter((p: any) => p.group === group && matches(p));
        if (rows.length === 0) return null;
        return (
          <section key={group} aria-label={group}>
            <h3 className="text-sm font-medium text-white mb-2">{group}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-800">
                    <th className="py-2 pr-4 font-medium">Feature</th>
                    <th className="py-2 px-3 font-medium text-center">Admin</th>
                    {ROLE_COLUMNS.map((c) => <th key={c.role} className="py-2 px-3 font-medium text-center">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p: any) => (
                    <tr key={p.key} className="border-b border-gray-800/60 align-top" data-feature={p.key}>
                      <td className="py-3 pr-4">
                        <p className="text-white">{p.label}</p>
                        <p className="text-xs text-gray-500 mt-0.5 max-w-xl">{p.description}</p>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex justify-center" title="Admins always have access">
                          <PillSwitch checked disabled onChange={() => undefined} ariaLabel={`${p.label}: Admin (always on)`} />
                        </div>
                      </td>
                      {ROLE_COLUMNS.map((c) => (
                        <td key={c.role} className="py-3 px-3">
                          <div className="flex justify-center">
                            <PillSwitch checked={on(p.key, c.role, p.defaults[c.role])} onChange={(v) => toggle(p, c.role, v)} ariaLabel={`${p.label}: ${c.label}`} />
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function EasterEggTab({ settings, setCategory }: any) {
  const egg = settings.easterEgg;
  const toggles = [
    { key: 'enabled', label: 'Enable Bypass Access terminal', hint: 'When off, Access Restricted shows no Bypass button.' },
    { key: 'matrixEffects', label: 'Matrix background effects', hint: 'Auto-disables on slow devices and for reduced-motion users.' },
    { key: 'pasteCountsAsAttempt', label: 'Paste attempts count toward the attempt limit', hint: 'Pastes are always blocked and never read, whatever this is set to.' },
  ];
  return (
    <div className="space-y-4">
      {toggles.map((t) => (
        <label key={t.key} className="flex items-start gap-3 p-2 rounded hover:bg-white/5 cursor-pointer">
          <input
            type="checkbox"
            checked={egg[t.key]}
            onChange={(e) => setCategory('easterEgg', { [t.key]: e.target.checked })}
            className="w-4 h-4 mt-0.5 accent-emerald-500"
          />
          <span>
            <span className="block text-sm text-gray-300">{t.label}</span>
            <span className={hintCls}>{t.hint}</span>
          </span>
        </label>
      ))}
      <div className="max-w-xs">
        <label className={labelCls}>Max terminal attempts</label>
        <input
          type="number"
          min={30}
          max={50}
          value={egg.maxAttempts}
          onChange={(e) => setCategory('easterEgg', { maxAttempts: parseInt(e.target.value) || 0 })}
          className={inputCls}
        />
        <p className={hintCls}>30–50. The LULLZ YOU WISH finale plays on the last attempt.</p>
      </div>
      <div className="pt-4 border-t border-gray-800">
        <LiveMonitor />
      </div>
    </div>
  );
}

const PLACEHOLDER_DATE_DEFAULTS = { startDate: 'Month DD, YYYY', endDate: 'DD-MM-YYYY', generationDate: 'Month DD, YYYY' };

function FormattingTab({ settings, setCategory }: any) {
  const f = settings.formatting;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label className={labelCls}>Date Format</label>
        <select value={f.dateFormat} onChange={(e) => setCategory('formatting', { dateFormat: e.target.value })} className={inputCls}>
          <option value="DD/MM/YYYY">DD/MM/YYYY</option>
          <option value="MM/DD/YYYY">MM/DD/YYYY</option>
          <option value="YYYY-MM-DD">YYYY-MM-DD</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>Time Format</label>
        <select value={f.timeFormat} onChange={(e) => setCategory('formatting', { timeFormat: e.target.value })} className={inputCls}>
          <option value="24h">24-hour</option>
          <option value="12h">12-hour (AM/PM)</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>Number Format Locale</label>
        <input value={f.numberFormat} onChange={(e) => setCategory('formatting', { numberFormat: e.target.value })} className={inputCls} placeholder="e.g. en-IN" />
      </div>
      <div>
        <label className={labelCls}>Report Date Format</label>
        <select value={f.reportDateFormat} onChange={(e) => setCategory('formatting', { reportDateFormat: e.target.value })} className={inputCls}>
          <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          <option value="DD-MM-YYYY">DD-MM-YYYY</option>
          <option value="MM-DD-YYYY">MM-DD-YYYY</option>
          <option value="DD/MM/YYYY">DD/MM/YYYY</option>
          <option value="MM/DD/YYYY">MM/DD/YYYY</option>
          <option value="DD.MM.YYYY">DD.MM.YYYY</option>
          <option value="YYYY/MM/DD">YYYY/MM/DD</option>
        </select>
        <p className={hintCls}>
          Controls every {'{Report Date}'} placeholder — generated reports, report filenames, and Issue Log filenames.
          Applies to reports/files generated after this is changed; already-generated files are unaffected.
        </p>
      </div>
      <div className="md:col-span-2 border-t border-gray-700/60 pt-4">
        <h3 className="text-sm font-medium text-white mb-1">Additional date placeholder formats</h3>
        <p className={hintCls}>Format of each date placeholder in generated reports. The Report Date placeholder above has its own setting. Applies to reports generated after this is changed; already-generated files are unaffected.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
          {([
            ['startDate', '{Start Date}'],
            ['endDate', '{End Date}'],
            ['generationDate', '{Month DD, YYYY} / Report Generation Date'],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <label className={labelCls}>{label}</label>
              <select
                value={f.placeholderDates?.[key] ?? PLACEHOLDER_DATE_DEFAULTS[key]}
                onChange={(e) => setCategory('formatting', { placeholderDates: { ...PLACEHOLDER_DATE_DEFAULTS, ...f.placeholderDates, [key]: e.target.value } })}
                className={inputCls}
              >
                {['Month DD, YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY', 'MM-DD-YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YYYY', 'YYYY/MM/DD'].map((o) => (
                  <option key={o} value={o}>{o === 'Month DD, YYYY' ? 'Month DD, YYYY (e.g. October 05, 2026)' : o}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
      <p className={`${hintCls} md:col-span-2`}>Date Format, Time Format and Number Format Locale apply to every date, time and number shown in the application.</p>
    </div>
  );
}

function IssueLogTab({ settings, setCategory }: any) {
  const cols: { key: string; label: string; enabled: boolean }[] = settings.issueLog.columns;
  const set = (next: typeof cols) => setCategory('issueLog', { columns: next });
  const move = (i: number, d: number) => {
    const next = [...cols];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set(next);
  };
  // Drag and drop reorder (arrow buttons remain for keyboard users). Only the order changes; each row keeps its own enabled flag.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const drop = (toKey: string) => {
    const from = cols.findIndex((c) => c.key === dragKey);
    const to = cols.findIndex((c) => c.key === toKey);
    setDragKey(null);
    setOverKey(null);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...cols];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    set(next);
  };
  return (
    <div className="space-y-3">
      <p className={hintCls}>
        Drag columns (or use the arrows) to change their order. Columns are included in generated Issue Logs in this order. Applies to future Issue Logs only; already-downloaded files are unchanged.
      </p>
      {cols.map((c, i) => (
        <div
          key={c.key}
          draggable
          onDragStart={(e) => { setDragKey(c.key); e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={(e) => { if (dragKey) { e.preventDefault(); setOverKey(c.key); } }}
          onDrop={(e) => { e.preventDefault(); drop(c.key); }}
          onDragEnd={() => { setDragKey(null); setOverKey(null); }}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-grab active:cursor-grabbing transition-colors ${
            dragKey === c.key ? 'opacity-40 border-gray-700 bg-gray-800/50'
            : overKey === c.key && dragKey ? 'border-emerald-400 bg-emerald-500/10'
            : 'bg-gray-800/50 border-gray-700'
          }`}
        >
          <GripVertical className="w-4 h-4 shrink-0 text-gray-500" aria-hidden />
          <input type="checkbox" checked={c.enabled} onChange={(e) => set(cols.map((x) => (x.key === c.key ? { ...x, enabled: e.target.checked } : x)))} />
          <span className="flex-1 text-sm text-white">{c.label}</span>
          <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="text-gray-400 hover:text-white disabled:opacity-30" aria-label={`Move ${c.label} up`}><ArrowUp className="w-4 h-4" /></button>
          <button type="button" disabled={i === cols.length - 1} onClick={() => move(i, 1)} className="text-gray-400 hover:text-white disabled:opacity-30" aria-label={`Move ${c.label} down`}><ArrowDown className="w-4 h-4" /></button>
        </div>
      ))}
    </div>
  );
}

function SystemTab({ settings, setCategory }: any) {
  const sys = settings.system;
  const [health, setHealth] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  useEffect(() => {
    api.get('/settings/system-health')
      .then((res) => setHealth(res.data))
      .finally(() => setHealthLoading(false));
  }, []);

  const StatusBadge = ({ status }: { status: string }) => (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${status === 'up' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
      {status === 'up' ? 'Online' : 'Offline'}
    </span>
  );

  const UsageBar = ({ usedMb, totalMb }: { usedMb: number | null; totalMb: number }) => {
    if (usedMb == null) return <p className="text-xs text-gray-600 mt-2">Usage unavailable</p>;
    const pct = Math.min(100, Math.round((usedMb / totalMb) * 100));
    const level = pct >= 90 ? 'critical' : pct >= 70 ? 'warning' : 'healthy';
    const barColor = level === 'critical' ? 'bg-red-500' : level === 'warning' ? 'bg-amber-500' : 'bg-emerald-500';
    const textColor = level === 'critical' ? 'text-red-400' : level === 'warning' ? 'text-amber-400' : 'text-emerald-400';
    return (
      <div className="mt-2">
        <div className="h-1.5 rounded-full bg-gray-700 overflow-hidden">
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
        <p className={`text-xs mt-1 ${textColor}`}>
          {(usedMb / 1024).toFixed(1)} GB / {(totalMb / 1024).toFixed(1)} GB used ({pct}%)
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-medium text-white mb-3">System Health &amp; Configuration</h3>
        {healthLoading ? (
          <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
        ) : health ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-gray-800/30 border border-gray-700">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-white">Backend</span>
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400">Online</span>
              </div>
              <p className="text-xs text-gray-500">Port {health.backend.port} · {health.backend.nodeEnv} · up {Math.floor(health.backend.uptimeSeconds / 60)}m · {health.backend.memoryUsedMb} MB RSS</p>
            </div>
            <div className="p-3 rounded-lg bg-gray-800/30 border border-gray-700">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-white">PostgreSQL (DB Storage)</span>
                <StatusBadge status={health.database.status} />
              </div>
              <p className="text-xs text-gray-500">Port {health.database.port}</p>
              <UsageBar usedMb={health.database.usedMb} totalMb={health.database.totalMb} />
            </div>
            <div className="p-3 rounded-lg bg-gray-800/30 border border-gray-700">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-white">Redis</span>
                <StatusBadge status={health.redis.status} />
              </div>
              <p className="text-xs text-gray-500">Port {health.redis.port} · sessions &amp; rate-limiting</p>
            </div>
            <div className="p-3 rounded-lg bg-gray-800/30 border border-gray-700">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-white">Object Storage (Reports &amp; PoCs)</span>
                <StatusBadge status={health.storage.status} />
              </div>
              <p className="text-xs text-gray-500">{health.storage.endpoint}:{health.storage.port} · bucket "{health.storage.bucket}"</p>
              <UsageBar usedMb={health.storage.usedMb} totalMb={health.storage.totalMb} />
            </div>
          </div>
        ) : (
          <p className={hintCls}>Could not load system health.</p>
        )}
      </div>
      <div className="border-t border-gray-700 pt-6">
        <h3 className="text-sm font-medium text-white mb-3">Storage Quotas</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Total Storage Quota (MB)</label>
            <input type="number" min={1} value={sys.totalStorageQuotaMb} onChange={(e) => setCategory('system', { totalStorageQuotaMb: parseInt(e.target.value) || 0 })} className={inputCls} />
            <p className={hintCls}>Enforced: once the storage bucket (reports, PoC attachments, Nessus files) reaches this size, new uploads are refused until files are deleted or the quota is raised.</p>
          </div>
          <div>
            <label className={labelCls}>Total Database Quota (MB)</label>
            <input type="number" min={1} value={sys.totalDatabaseQuotaMb} onChange={(e) => setCategory('system', { totalDatabaseQuotaMb: parseInt(e.target.value) || 0 })} className={inputCls} />
            <p className={hintCls}>Enforced: once the PostgreSQL database reaches this size, requests that create or change data are refused (HTTP 507); viewing, deleting, login and settings still work.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
