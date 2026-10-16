'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Loader2, Save, FolderKanban } from 'lucide-react';
import { api } from '@/contexts/auth-context';
import { NetworkLimitationCaution } from '@/components/network-limitation-caution';
import { ScopeImportButton } from '@/components/scope-import-button';
import { useToast } from '@/components/toast-provider';

const inputCls =
  'w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm text-white transition-all';
const labelCls = 'block text-sm text-gray-300 mb-1';

export default function NewProjectPage() {
  const toast = useToast();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    // Core
    name: '',
    clientName: '',
    category: 'VAPT',
    subType: 'WEB',
    scope: '',
    startDate: '',
    endDate: '',
    complianceType: 'VAPT',
    // Report detail fields — captured once, reused at report generation
    appVersion: '',
    location: '',
    documentVersion: '1.0',
    toolsUsed: '',
    testingEnvironment: '',
    qaReviewerName: '',
    applicationDetails: '',
    testingType: '',
    loginSystemTypes: '',
    applicationNature: '',
    testingLimitation: '',
    mobilePlatform: '',
    sha1: '',
    externalInternal: '',
    networkActivityType: '',
    totalScopeCount: '',
    quarter: '',
  });

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  // Network projects have no "Application Name" field — the project still
  // needs an identifying name (project lists, file names), so derive one
  // from client + quarter instead of asking for it.
  useEffect(() => {
    if (form.subType !== 'NETWORK') return;
    const derived = [form.clientName, 'Network', form.quarter].filter(Boolean).join(' - ');
    if (derived && derived !== form.name) set('name', derived);
  }, [form.subType, form.clientName, form.quarter]);

  const [networkScope, setNetworkScope] = useState<{ ip: string; domainHostname: string; purpose: string }[]>([]);
  // Imported rows are appended after any rows the user has actually filled in (untouched blank rows are dropped).
  const importScopeRows = (added: { ip: string; domainHostname: string; purpose: string }[]) =>
    setNetworkScope((rows) => [...rows.filter((r) => r.ip || r.domainHostname || r.purpose), ...added]);
  const addScopeRow = () => setNetworkScope((rows) => [...rows, { ip: '', domainHostname: '', purpose: '' }]);
  const removeScopeRow = (i: number) => setNetworkScope((rows) => rows.filter((_, idx) => idx !== i));
  const setScopeRow = (i: number, key: 'ip' | 'domainHostname' | 'purpose', value: string) =>
    setNetworkScope((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  const [toolsUsedTable, setToolsUsedTable] = useState<{ name: string; version: string; licenseType: string }[]>([]);
  const addToolRow = () => setToolsUsedTable((rows) => [...rows, { name: '', version: '', licenseType: 'Open Source' }]);
  const removeToolRow = (i: number) => setToolsUsedTable((rows) => rows.filter((_, idx) => idx !== i));
  const setToolRow = (i: number, key: 'name' | 'version' | 'licenseType', value: string) =>
    setToolsUsedTable((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  const [customFields, setCustomFields] = useState<any[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const setCustomFieldValue = (name: string, value: string) =>
    setCustomFieldValues((prev) => ({ ...prev, [name]: value }));

  useEffect(() => {
    let cancelled = false;
    api.get(`/reports/templates?category=${form.category}&subType=${form.subType}&reportFormat=WORD`)
      .then(async (res) => {
        const template = res.data[0];
        if (!template) return;
        const fieldsRes = await api.get(`/reports/templates/${template.id}/fields`);
        if (!cancelled) setCustomFields(fieldsRes.data.filter((f: any) => f.isCustom));
      })
      .catch(() => { if (!cancelled) setCustomFields([]); });
    return () => { cancelled = true; };
  }, [form.category, form.subType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload: any = {
        name: form.name,
        clientName: form.clientName,
        category: form.category,
        subType: form.subType,
        complianceType: form.complianceType,
        startDate: form.startDate,
      };
      if (form.subType !== 'NETWORK') payload.scope = form.scope;
      // Optional fields — only send when filled
      const optional = [
        'endDate', 'appVersion', 'location', 'documentVersion', 'toolsUsed',
        'testingEnvironment', 'qaReviewerName', 'applicationDetails', 'testingType',
        'loginSystemTypes', 'applicationNature', 'testingLimitation',
        'mobilePlatform', 'sha1', 'externalInternal', 'networkActivityType', 'quarter',
      ];
      for (const key of optional) {
        if ((form as any)[key]) payload[key] = (form as any)[key];
      }
      if (form.totalScopeCount) payload.totalScopeCount = parseInt(form.totalScopeCount, 10);
      if (form.subType === 'NETWORK' && networkScope.length > 0) payload.networkScope = networkScope;
      if (toolsUsedTable.length > 0) payload.toolsUsedTable = toolsUsedTable;
      if (Object.keys(customFieldValues).length > 0) payload.customFieldValues = customFieldValues;

      const res = await api.post('/projects', payload);
      toast('Project created');
      router.push(`/dashboard/projects/${res.data.id}`);
    } catch (error: any) {
      toast(error.response?.data?.message || 'Failed to create project', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/dashboard/projects')}
          className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-800 text-gray-400 transition-all"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">New Project</h1>
          <p className="text-gray-400 text-sm mt-1">
            These details are captured once and automatically reused in the generated report
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Core details */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center gap-3 pb-3 border-b border-gray-700">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <FolderKanban className="w-4 h-4 text-emerald-400" />
            </div>
            <h2 className="text-base font-semibold text-white">Project Basics</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Compliance Category *</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value, complianceType: e.target.value }))}
                className={inputCls}
              >
                <option value="VAPT">VAPT</option>
                <option value="PCI">PCI</option>
                <option value="CERT_IN">Cert-IN</option>
                <option value="ASV">ASV</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Testing Type (Platform) *</label>
              <select value={form.subType} onChange={(e) => set('subType', e.target.value)} className={inputCls}>
                <option value="WEB">Web Application</option>
                <option value="API">API</option>
                <option value="MOBILE">Mobile Application</option>
                <option value="THICK_CLIENT">Thick Client</option>
                <option value="NETWORK">Network</option>
                <option value="APPLICATION">Application</option>
              </select>
            </div>
            {form.subType !== 'NETWORK' && (
              <div>
                <label className={labelCls}>Application Name *</label>
                <input type="text" required value={form.name} onChange={(e) => set('name', e.target.value)} className={inputCls} placeholder="e.g. Payments Portal" />
              </div>
            )}
            <div>
              <label className={labelCls}>App Version</label>
              <input type="text" value={form.appVersion} onChange={(e) => set('appVersion', e.target.value)} className={inputCls} placeholder="e.g. 4.2.1" />
            </div>
            <div>
              <label className={labelCls}>Client Name *</label>
              <input type="text" required value={form.clientName} onChange={(e) => set('clientName', e.target.value)} className={inputCls} placeholder="e.g. Acme Bank" />
            </div>
            <div>
              <label className={labelCls}>Location</label>
              <input type="text" value={form.location} onChange={(e) => set('location', e.target.value)} className={inputCls} placeholder="e.g. Mumbai, India" />
            </div>
            <div>
              <label className={labelCls}>Start Date *</label>
              <input type="date" required value={form.startDate} onChange={(e) => set('startDate', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>End Date</label>
              <input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Current Document Version</label>
              <input type="text" value={form.documentVersion} onChange={(e) => set('documentVersion', e.target.value)} className={inputCls} placeholder="e.g. 1.0" />
            </div>
            <div>
              <label className={labelCls}>QA Reviewer Name</label>
              <input type="text" value={form.qaReviewerName} onChange={(e) => set('qaReviewerName', e.target.value)} className={inputCls} />
            </div>
          </div>

          {form.subType !== 'NETWORK' && (
            <div>
              <label className={labelCls}>Scope *</label>
              <textarea rows={3} required value={form.scope} onChange={(e) => set('scope', e.target.value)} className={inputCls} placeholder="In-scope URLs, endpoints, IP ranges..." />
            </div>
          )}
        </motion.section>

        {/* Testing details */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card rounded-xl p-6 space-y-4"
        >
          <h2 className="text-base font-semibold text-white pb-3 border-b border-gray-700">Testing Details</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Testing Environment</label>
              <select value={form.testingEnvironment} onChange={(e) => set('testingEnvironment', e.target.value)} className={inputCls}>
                <option value="">Select environment</option>
                <option value="Staging">Staging</option>
                <option value="UAT">UAT</option>
                <option value="Pre-Prod">Pre-Prod</option>
                <option value="Production">Production</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Testing Approach</label>
              <select value={form.testingType} onChange={(e) => set('testingType', e.target.value)} className={inputCls}>
                <option value="">Select approach</option>
                <option value="Black Box">Black Box</option>
                <option value="Grey Box">Grey Box</option>
                <option value="White Box">White Box</option>
              </select>
            </div>
            {form.subType !== 'NETWORK' && (
              <div>
                <label className={labelCls}>Types of Login System</label>
                <input type="text" value={form.loginSystemTypes} onChange={(e) => set('loginSystemTypes', e.target.value)} className={inputCls} placeholder="e.g. Admin, Manager, Customer roles" />
              </div>
            )}
            {form.subType === 'MOBILE' && (
              <div>
                <label className={labelCls}>Android/iOS</label>
                <select value={form.mobilePlatform} onChange={(e) => set('mobilePlatform', e.target.value)} className={inputCls}>
                  <option value="">Select platform</option>
                  <option value="Android">Android</option>
                  <option value="iOS">iOS</option>
                </select>
              </div>
            )}
            {(form.subType === 'MOBILE' || form.subType === 'THICK_CLIENT') && (
              <div>
                <label className={labelCls}>SHA-1</label>
                <input type="text" value={form.sha1} onChange={(e) => set('sha1', e.target.value)} className={inputCls} placeholder="e.g. AA:BB:CC:..." />
              </div>
            )}
            {form.subType === 'NETWORK' && (
              <>
                <div>
                  <label className={labelCls}>Scope Exposure</label>
                  <select value={form.externalInternal} onChange={(e) => set('externalInternal', e.target.value)} className={inputCls}>
                    <option value="">Select exposure</option>
                    <option value="External">External</option>
                    <option value="Internal">Internal</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Network Activity Type</label>
                  <select value={form.networkActivityType} onChange={(e) => set('networkActivityType', e.target.value)} className={inputCls}>
                    <option value="">Select activity type</option>
                    <option value="VA">VA</option>
                    <option value="PT">PT</option>
                    <option value="VAPT">VAPT</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Total Scope Count</label>
                  <input type="number" min="0" value={form.totalScopeCount} onChange={(e) => set('totalScopeCount', e.target.value)} className={inputCls} />
                </div>
              </>
            )}
          </div>

          {form.subType === 'NETWORK' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={labelCls}>Network Scope</label>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <ScopeImportButton rows={networkScope} onImport={importScopeRows} />
                  <button type="button" onClick={addScopeRow} className="text-xs text-emerald-400 hover:text-emerald-300">+ Add Row</button>
                </div>
              </div>
              <div className="space-y-2">
                {networkScope.map((row, i) => (
                  <div key={i} className="grid grid-cols-1 md:grid-cols-[2rem_1fr_1fr_1fr_auto] gap-2 items-center">
                    <span className="text-xs text-gray-500 md:text-right" aria-label="S.No">{i + 1}</span>
                    <input type="text" value={row.ip || ''} onChange={(e) => setScopeRow(i, 'ip', e.target.value)} className={inputCls} placeholder="IP" />
                    <input type="text" value={row.domainHostname || ''} onChange={(e) => setScopeRow(i, 'domainHostname', e.target.value)} className={inputCls} placeholder="Domain / Hostname" />
                    <input type="text" value={row.purpose || ''} onChange={(e) => setScopeRow(i, 'purpose', e.target.value)} className={inputCls} placeholder="Purpose" />
                    <button type="button" onClick={() => removeScopeRow(i)} className="text-xs text-red-400 hover:text-red-300 px-2">Remove</button>
                  </div>
                ))}
                {networkScope.length === 0 && <p className="text-xs text-gray-500">No scope rows added yet.</p>}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls}>Tools Used</label>
              <button type="button" onClick={addToolRow} className="text-xs text-emerald-400 hover:text-emerald-300">+ Add Row</button>
            </div>
            <div className="space-y-2">
              {toolsUsedTable.map((row, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                  <input type="text" value={row.name || ''} onChange={(e) => setToolRow(i, 'name', e.target.value)} className={inputCls} placeholder="Name" />
                  <input type="text" value={row.version || ''} onChange={(e) => setToolRow(i, 'version', e.target.value)} className={inputCls} placeholder="Version" />
                  <select value={row.licenseType || 'Open Source'} onChange={(e) => setToolRow(i, 'licenseType', e.target.value)} className={inputCls}>
                    <option value="Open Source">Open Source</option>
                    <option value="Licensed">Licensed</option>
                  </select>
                  <button type="button" onClick={() => removeToolRow(i)} className="text-xs text-red-400 hover:text-red-300 px-2">Remove</button>
                </div>
              ))}
              {toolsUsedTable.length === 0 && <p className="text-xs text-gray-500">No tools added yet.</p>}
            </div>
          </div>

          {form.subType !== 'NETWORK' && (
            <div>
              <label className={labelCls}>Application / Build Details</label>
              <textarea rows={2} value={form.applicationDetails} onChange={(e) => set('applicationDetails', e.target.value)} className={inputCls} placeholder="Tech stack, platform, build info..." />
            </div>
          )}
          <div>
            <label className={labelCls}>Quarter/Frequency</label>
            <input type="text" value={form.quarter} onChange={(e) => set('quarter', e.target.value)} className={inputCls} placeholder="e.g. Q1, H1, Annually, Half-yearly" />
          </div>
          {form.subType !== 'NETWORK' && (
            <div>
              <label className={labelCls}>Nature / Purpose of the Application</label>
              <textarea rows={2} value={form.applicationNature} onChange={(e) => set('applicationNature', e.target.value)} className={inputCls} placeholder="What the application is used for..." />
            </div>
          )}
          <div>
            <label className={labelCls}>Testing Limitation</label>
            <textarea rows={2} value={form.testingLimitation} onChange={(e) => set('testingLimitation', e.target.value)} className={inputCls} placeholder="Leave empty for N/A" />
            {form.subType === 'NETWORK' && <NetworkLimitationCaution />}
          </div>
        </motion.section>

        {customFields.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card rounded-xl p-6 space-y-4"
          >
            <h2 className="text-base font-semibold text-white pb-3 border-b border-gray-700">Additional Template Fields</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {customFields.map((field) => (
                <div key={field.id}>
                  <label className={labelCls}>{field.name}</label>
                  <input
                    value={customFieldValues[field.normalizedName] || ''}
                    onChange={(e) => setCustomFieldValue(field.normalizedName, e.target.value)}
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          </motion.section>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => router.push('/dashboard/projects')}
            className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50 flex items-center gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {submitting ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  );
}
