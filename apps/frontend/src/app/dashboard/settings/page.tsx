'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Settings as SettingsIcon, Palette, LayoutGrid, ShieldCheck, Paperclip, Bell, Calendar, ListOrdered, ArrowUp, ArrowDown, GripVertical, Save, Loader2, Clock, ServerCog, Egg } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/contexts/auth-context';
import { useToast } from '@/components/toast-provider';
import { LiveMonitor } from '@/components/easter-egg/live-monitor';
import { formatDateTime } from '@/lib/datetime';
import { THEMES } from '@/lib/themes';

const TABS = [
  { id: 'general', label: 'General & Branding', icon: Palette },
  { id: 'appearance', label: 'Appearance', icon: LayoutGrid },
  { id: 'workflow', label: 'Workflow', icon: SettingsIcon },
  { id: 'security', label: 'Security & Sessions', icon: ShieldCheck },
  { id: 'attachments', label: 'Attachments', icon: Paperclip },
  { id: 'notifications', label: 'Notifications', icon: Bell },
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
  const [settings, setSettings] = useState<any>(null);
  const [meta, setMeta] = useState<{ updatedAt: string | null; updatedById: string | null }>({ updatedAt: null, updatedById: null });
  const [history, setHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('general');
  const [saving, setSaving] = useState(false);

  const fetchSettings = async () => {
    const res = await api.get('/settings');
    setSettings(res.data.settings);
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
        {activeTab === 'attachments' && <AttachmentsTab settings={settings} setCategory={setCategory} />}
        {activeTab === 'notifications' && <NotificationsTab settings={settings} setCategory={setCategory} />}
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
                  <span className="text-white font-medium">{log.actor?.username || 'Deleted user'}</span>
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
          <div>
            <label className={labelCls}>Logo URL</label>
            <input value={g.logoUrl} onChange={(e) => setCategory('general', { logoUrl: e.target.value })} className={inputCls} placeholder="https://..." />
          </div>
          <div>
            <label className={labelCls}>Favicon URL</label>
            <input value={g.faviconUrl} onChange={(e) => setCategory('general', { faviconUrl: e.target.value })} className={inputCls} placeholder="https://..." />
          </div>
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

function AttachmentsTab({ settings, setCategory }: any) {
  const at = settings.attachments;
  return (
    <div className="space-y-4">
      <TagListEditor
        label="Allowed File Types"
        values={at.allowedFileTypes}
        onChange={(v) => setCategory('attachments', { allowedFileTypes: v })}
        hint="Include the leading dot, e.g. .png"
      />
      <div>
        <label className={labelCls}>Max File Size (MB)</label>
        <input type="number" min={1} max={500} value={at.maxFileSizeMb} onChange={(e) => setCategory('attachments', { maxFileSizeMb: parseInt(e.target.value) || 0 })} className={inputCls} />
        <p className={hintCls}>Allowed range: 1–500 MB. Not yet enforced at every upload endpoint — stored centrally for future integration.</p>
      </div>
    </div>
  );
}

function NotificationsTab({ settings, setCategory }: any) {
  const n = settings.notifications;
  const ALL_TYPES = ['VULNERABILITY_REQUESTED', 'VULNERABILITY_APPROVED', 'VULNERABILITY_REJECTED', 'USER_CREATED', 'USER_UPDATED'];
  const toggle = (type: string) => {
    const enabled = n.defaultEnabledTypes.includes(type);
    const next = enabled ? n.defaultEnabledTypes.filter((t: string) => t !== type) : [...n.defaultEnabledTypes, type];
    setCategory('notifications', { defaultEnabledTypes: next });
  };
  return (
    <div className="space-y-2">
      <p className={hintCls}>Default notification types enabled for new users.</p>
      {ALL_TYPES.map((type) => (
        <label key={type} className="flex items-center gap-3 p-2 rounded hover:bg-white/5 cursor-pointer">
          <input
            type="checkbox"
            checked={n.defaultEnabledTypes.includes(type)}
            onChange={() => toggle(type)}
            className="w-4 h-4 accent-emerald-500"
          />
          <span className="text-sm text-gray-300">{type.replace(/_/g, ' ')}</span>
        </label>
      ))}
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
      <p className={`${hintCls} col-span-2`}>Date Format/Number Format above are not yet wired into rendering across the app — stored centrally so a future pass can consume one source of truth.</p>
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
                <span className="text-sm text-white">MinIO Storage (Reports &amp; PoCs)</span>
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
            <p className={hintCls}>Used against the MinIO bucket storing reports and PoC attachments.</p>
          </div>
          <div>
            <label className={labelCls}>Total Database Quota (MB)</label>
            <input type="number" min={1} value={sys.totalDatabaseQuotaMb} onChange={(e) => setCategory('system', { totalDatabaseQuotaMb: parseInt(e.target.value) || 0 })} className={inputCls} />
            <p className={hintCls}>Used against live PostgreSQL database size.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
