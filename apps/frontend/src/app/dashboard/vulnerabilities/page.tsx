'use client';

import { Fragment, useEffect, useLayoutEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Search, Pencil, Trash2, X, Plus, Download, CheckCircle, XCircle, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, Upload, RefreshCw, Clock } from 'lucide-react';
import { api, useAuth } from '@/contexts/auth-context';
import { useBranding } from '@/contexts/branding-context';
import { useToast } from '@/components/toast-provider';
import { useConfirm } from '@/components/confirm-provider';
import { formatDateTime } from '@/lib/datetime';
import { stripCvssPrefix } from '@/lib/cvss';

const DEFAULT_SEVERITY_COLORS: Record<string, string> = {
  Critical: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#3b82f6', Info: '#6b7280',
};

// Admin-configurable (Settings > Workflow > Severity Labels & Colors) — falls back
// to the platform defaults above until settings load or for unrecognized severities.
function severityBadgeStyle(severityColors: Record<string, string>, severity: string) {
  const hex = severityColors[severity] || severityColors.Info || DEFAULT_SEVERITY_COLORS.Info;
  return { backgroundColor: `${hex}1a`, color: hex, borderColor: `${hex}33` };
}

const statusColors: Record<string, string> = {
  APPROVED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  PENDING: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  REJECTED: 'bg-red-500/10 text-red-400 border-red-500/20',
};

interface SortConfig {
  field: string;
  order: 'asc' | 'desc';
}

type BulkVersion = { severity: string; cvssScore: number | null; cvssVector: string | null; cveId: string | null; cweId: string | null; description: string; impact: string; remediation: string; references: string };
type BulkDuplicate = {
  key: string;
  name: string;
  // The entry the category already has under this name (merge only); choosing it is sent as row 0.
  existing?: BulkVersion | null;
  rows: { row: number; severity: string; cvssScore: number | null; cvssVector: string | null; cveId: string | null; cweId: string | null; description: string; impact: string; remediation: string; references: string }[];
};

export default function VulnerabilitiesPage() {
  const { user } = useAuth();
  const [vulnerabilities, setVulnerabilities] = useState<any[]>([]);
  const [pendingVulns, setPendingVulns] = useState<any[]>([]);
  const [pendingChangeRequests, setPendingChangeRequests] = useState<any[]>([]);
  const [viewingChangeRequest, setViewingChangeRequest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<SortConfig>({ field: 'cvssScore', order: 'desc' });
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [editingVuln, setEditingVuln] = useState<any>(null);
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'changeTracker'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Where the row was clicked (viewport coords — fixed positioning ignores
  // page scroll, so this never shifts the scroll position) and the
  // clamped, fully-on-screen position the dialog settles into.
  const [clickOrigin, setClickOrigin] = useState<{ x: number; y: number } | null>(null);
  const [modalPos, setModalPos] = useState<{ left: number; top: number } | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const openVulnDetail = (id: string, e: { clientX: number; clientY: number }) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setClickOrigin({ x: e.clientX, y: e.clientY });
    setModalPos(null);
    setExpandedId(id);
  };

  useLayoutEffect(() => {
    if (!expandedId || !clickOrigin || !modalRef.current) return;
    // offsetWidth/Height (not getBoundingClientRect) — the entrance animation's
    // initial scale is already applied to the element at this point, and
    // getBoundingClientRect reports the post-transform (shrunk) box.
    const width = modalRef.current.offsetWidth;
    const height = modalRef.current.offsetHeight;
    const margin = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = clickOrigin.x - width / 2;
    let top = clickOrigin.y - height / 2;
    left = Math.min(Math.max(left, margin), Math.max(margin, vw - width - margin));
    top = Math.min(Math.max(top, margin), Math.max(margin, vh - height - margin));
    setModalPos({ left, top });
  }, [expandedId, clickOrigin]);
  const [severityColors, setSeverityColors] = useState<Record<string, string>>(DEFAULT_SEVERITY_COLORS);

  // Bulk upload state
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [showBulkError, setShowBulkError] = useState(false);
  const [bulkErrorMsg, setBulkErrorMsg] = useState('');
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkMode, setBulkMode] = useState<'REPLACE' | 'MERGE'>('REPLACE');
  // Names repeated in the uploaded file: key -> competing rows, and the row the admin picked for each.
  const [bulkDuplicates, setBulkDuplicates] = useState<BulkDuplicate[]>([]);
  const [bulkChoices, setBulkChoices] = useState<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);

  const isAdminOrTL = user?.role === 'ADMIN' || user?.role === 'AVP' || user?.role === 'TEAM_LEAD';
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    fetchVulnerabilities();
    if (isAdminOrTL) fetchPending();
  }, [search, severity, category, sort, activeTab]);

  // Reuses the app-wide settings the branding provider already fetched once
  // per session, instead of this page issuing its own duplicate GET /settings.
  const { settings } = useBranding();
  useEffect(() => {
    const colors = settings?.workflow?.severityColors;
    if (colors) setSeverityColors({ ...DEFAULT_SEVERITY_COLORS, ...colors });
  }, [settings]);

  const fetchVulnerabilities = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (severity) params.set('severity', severity);
      if (category) params.set('category', category);
      params.set('sortBy', sort.field);
      params.set('sortOrder', sort.order);
      const response = await api.get(`/vulnerabilities?${params.toString()}`);
      setVulnerabilities(response.data);
    } catch (error) {
      console.error('Failed to fetch vulnerabilities:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPending = async () => {
    try {
      const [pendingRes, changeRes] = await Promise.all([
        api.get('/vulnerabilities/pending'),
        api.get('/vulnerabilities/change-requests/pending'),
      ]);
      setPendingVulns(pendingRes.data);
      setPendingChangeRequests(changeRes.data);
    } catch (error) {
      console.error('Failed to fetch pending:', error);
    }
  };

  const handleRefresh = () => {
    fetchVulnerabilities();
    if (isAdminOrTL) fetchPending();
    toast('Vulnerability database refreshed', 'info');
  };

  const handleSort = (field: string) => {
    setSort(prev => ({
      field,
      order: prev.field === field && prev.order === 'desc' ? 'asc' : 'desc',
    }));
  };

  const handleDelete = async (id: string) => {
    const ok = await confirmDialog({ title: 'Deactivate vulnerability?', message: 'This vulnerability will be deactivated and hidden from active listings.', confirmLabel: 'Deactivate', danger: true });
    if (!ok) return;
    try {
      await api.delete(`/vulnerabilities/${id}`);
      fetchVulnerabilities();
      toast('Vulnerability deactivated');
    } catch (error: any) {
      toast(error.response?.data?.message || 'Failed to deactivate vulnerability', 'error');
    }
  };

  const handleApprove = async (id: string, isChangeRequest?: boolean) => {
    try {
      await api.put(`/vulnerabilities/${isChangeRequest ? `change-requests/${id}` : id}/approve`);
      fetchPending();
      fetchVulnerabilities();
      toast(isChangeRequest ? 'Edit approved and applied' : 'Vulnerability approved');
    } catch (error: any) {
      toast(error.response?.data?.message || 'Approval failed', 'error');
    }
  };

  const handleReject = async (id: string, isChangeRequest?: boolean) => {
    try {
      await api.put(`/vulnerabilities/${isChangeRequest ? `change-requests/${id}` : id}/reject`);
      fetchPending();
      fetchVulnerabilities();
      toast(isChangeRequest ? 'Edit rejected — original data retained' : 'Vulnerability rejected');
    } catch (error: any) {
      toast(error.response?.data?.message || 'Rejection failed', 'error');
    }
  };

  const handleDownload = async () => {
    try {
      const response = await api.get(`/vulnerabilities/export?severity=${severity}`, {
        responseType: 'blob',
      });
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = severity ? `vulnerabilities-${severity.toLowerCase()}.csv` : 'vulnerabilities-all.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert('Download failed');
    }
  };

  // ─── Bulk Upload ───
  const handleBulkUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    const name = file.name.toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
      setBulkErrorMsg('Only .csv and .xlsx files are allowed. Please upload a valid file.');
      setShowBulkError(true);
      return;
    }

    // File content is validated and parsed server-side only — nothing here
    // is read or executed client-side, it's just handed off as data.
    pendingFileRef.current = file;
    setShowBulkConfirm(true);
  };

  const confirmBulkUpload = async (resolutions?: Record<string, number>) => {
    if (!pendingFileRef.current || !bulkCategory) return;
    setBulkUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', pendingFileRef.current);
      formData.append('category', bulkCategory);
      formData.append('mode', bulkMode);
      if (resolutions) formData.append('resolutions', JSON.stringify(resolutions));
      const response = await api.post('/vulnerabilities/bulk-upload', formData, {
        headers: { 'Content-Type': undefined },
      });
      toast(response.data.message || `Successfully uploaded ${response.data.count} vulnerabilities.`);
      setShowBulkConfirm(false);
      setBulkDuplicates([]);
      setBulkChoices({});
      pendingFileRef.current = null;
      setBulkCategory('');
      setBulkMode('REPLACE');
      fetchVulnerabilities();
    } catch (error: any) {
      const dups: BulkDuplicate[] | undefined = error.response?.data?.duplicates;
      setShowBulkConfirm(false);
      if (dups?.length) {
        // Nothing was uploaded; let the admin pick a version per repeated name, then send again.
        setBulkDuplicates(dups);
        setBulkChoices({});
        return;
      }
      const msg = error.response?.data?.message || 'Upload failed';
      setBulkErrorMsg(msg);
      setShowBulkError(true);
    } finally {
      setBulkUploading(false);
    }
  };

  const downloadSampleCsv = () => {
    window.open('/api/vulnerabilities/sample-csv', '_blank');
  };

  const openEditModal = (vuln: any) => {
    setEditingVuln({ ...vuln });
    setShowEditModal(true);
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sort.field !== field) return <ArrowUpDown className="w-3 h-3 text-gray-600" />;
    return sort.order === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-400" /> : <ArrowDown className="w-3 h-3 text-emerald-400" />;
  };

  // Admin/AVP/TL fetch every vulnerability including soft-deleted ones (isActive:
  // false) — needed elsewhere (e.g. history), but the Total list/count must only
  // ever show live vulnerabilities.
  // Pending tab shows two different kinds of items side by side: brand-new
  // vulnerability requests (status PENDING) and Testers' proposed edits to
  // already-approved records (change requests) — normalized to the same
  // row shape here so the table doesn't need to branch on rendering.
  const pendingChangeRows = pendingChangeRequests.map((cr) => ({
    id: cr.id,
    name: cr.vulnerability.name,
    severity: cr.afterData.severity ?? cr.vulnerability.severity,
    cvssScore: cr.afterData.cvssScore ?? cr.vulnerability.cvssScore,
    cvssVector: cr.afterData.cvssVector ?? cr.vulnerability.cvssVector,
    category: cr.vulnerability.category,
    cveId: cr.afterData.cveId ?? cr.vulnerability.cveId,
    cweId: cr.afterData.cweId ?? cr.vulnerability.cweId,
    description: cr.afterData.description ?? cr.vulnerability.description,
    impact: cr.afterData.impact ?? cr.vulnerability.impact,
    remediation: cr.afterData.remediation ?? cr.vulnerability.remediation,
    references: cr.afterData.references ?? cr.vulnerability.references,
    requestedBy: cr.requestedBy,
    isChangeRequest: true,
    _cr: cr,
  }));
  const displayVulns = activeTab === 'pending'
    ? [...pendingVulns, ...pendingChangeRows]
    : vulnerabilities.filter((v) => v.isActive);

  if (loading && displayVulns.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Vulnerability Database</h1>
          <p className="text-gray-400 text-sm mt-1">Manage and reference known vulnerabilities</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700/50 hover:bg-gray-700 text-gray-300 border border-gray-600/50 rounded-lg transition-all text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          {isAdmin && (
            <>
              <input
                type="file"
                accept=".csv,.xlsx"
                ref={fileInputRef}
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={handleBulkUploadClick}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border border-purple-500/20 rounded-lg transition-all text-sm"
              >
                <Upload className="w-4 h-4" />
                Bulk Upload
              </button>
            </>
          )}
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/20 rounded-lg transition-all text-sm"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-all text-sm"
          >
            <Plus className="w-4 h-4" />
            Add New
          </button>
        </div>
      </div>

      {/* Tabs */}
      {isAdminOrTL && (
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'all' ? 'bg-emerald-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:text-white'
            }`}
          >
            Total ({vulnerabilities.filter((v) => v.isActive).length})
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
              activeTab === 'pending' ? 'bg-amber-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:text-white'
            }`}
          >
            Pending Approval
            {(pendingVulns.length + pendingChangeRequests.length) > 0 && (
              <span className="w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
                {pendingVulns.length + pendingChangeRequests.length}
              </span>
            )}
          </button>
          {isAdmin && (
            <button
              onClick={() => setActiveTab('changeTracker')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                activeTab === 'changeTracker' ? 'bg-purple-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:text-white'
              }`}
            >
              <Clock className="w-4 h-4" /> Change Tracker
            </button>
          )}
        </div>
      )}

      {activeTab === 'changeTracker' ? (
        <ChangeTrackerTab />
      ) : (
      <>
      {/* Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text" placeholder="Search vulnerabilities..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 transition-all"
          />
        </div>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)}
          className="px-4 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 transition-all">
          <option value="">All Severities</option>
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
          <option value="Info">Info</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="px-4 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 transition-all">
          <option value="">All Categories</option>
          <option value="APPLICATION_API">Application/API</option>
          <option value="NETWORK">Network</option>
        </select>
      </div>

      {/* Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="px-4 py-3 text-sm font-medium text-gray-400 cursor-pointer hover:text-white" onClick={() => handleSort('name')}>
                  <div className="flex items-center gap-1">Name <SortIcon field="name" /></div>
                </th>
                <th className="px-4 py-3 text-sm font-medium text-gray-400 cursor-pointer hover:text-white" onClick={() => handleSort('severity')}>
                  <div className="flex items-center gap-1">Severity <SortIcon field="severity" /></div>
                </th>
                <th className="px-4 py-3 text-sm font-medium text-gray-400 cursor-pointer hover:text-white" onClick={() => handleSort('cvssScore')}>
                  <div className="flex items-center gap-1">CVSS <SortIcon field="cvssScore" /></div>
                </th>
                <th className="px-4 py-3 text-sm font-medium text-gray-400">Category</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-400">CVE / CWE</th>
                {activeTab === 'pending' && (
                  <th className="px-4 py-3 text-sm font-medium text-gray-400">Requested By</th>
                )}
                <th className="px-4 py-3 text-sm font-medium text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayVulns.map((vuln, i) => (
                <Fragment key={vuln.id}>
                <motion.tr
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  onClick={(e: React.MouseEvent) => openVulnDetail(vuln.id, e)}
                  className={`border-b border-gray-700/50 hover:bg-white/5 transition-colors cursor-pointer ${
                    expandedId === vuln.id ? 'bg-emerald-500/5' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-white">{vuln.name}</p>
                      <p className="text-xs text-gray-500 truncate max-w-xs">{vuln.description}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium border" style={severityBadgeStyle(severityColors, vuln.severity)}>
                      {vuln.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-white">{vuln.cvssScore ?? '-'}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium border border-gray-600 text-gray-300">
                      {vuln.category === 'NETWORK' ? 'Network' : 'Application/API'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {vuln.cveId && <span className="text-cyan-400">{vuln.cveId}</span>}
                    {vuln.cweId && <span className="text-violet-400 ml-2">{vuln.cweId}</span>}
                  </td>
                  {activeTab === 'pending' && (
                    <td className="px-4 py-3 text-sm text-gray-400">
                      <div className="flex items-center gap-2">
                        <span>{vuln.requestedBy?.username || 'Unknown'}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                          vuln.isChangeRequest
                            ? 'border-blue-500/30 text-blue-400'
                            : 'border-emerald-500/30 text-emerald-400'
                        }`}>
                          {vuln.isChangeRequest ? 'Edit' : 'New'}
                        </span>
                      </div>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {activeTab === 'pending' && isAdminOrTL ? (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleApprove(vuln.id, vuln.isChangeRequest); }}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
                            title="Approve"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleReject(vuln.id, vuln.isChangeRequest); }}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                            title="Reject"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                          {vuln.isChangeRequest ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); setViewingChangeRequest(vuln._cr); }}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 transition-all"
                              title="View proposed changes"
                            >
                              <Search className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); openEditModal(vuln); }}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 transition-all"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditModal(vuln); }}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {user?.role === 'ADMIN' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(vuln.id); }}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                              title="Deactivate"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </motion.tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {displayVulns.length === 0 && (
          <div className="text-center py-12">
            <ShieldAlert className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No vulnerabilities found</p>
          </div>
        )}
      </div>
      </>
      )}

      {/* Detail modal — overlays the page without navigating away, so
          table filters/sort/scroll position stay exactly as they were.
          Portaled to document.body: the dashboard layout's page-transition
          wrapper animates a transform, which makes it the containing block
          for any position:fixed descendant and would break the click-anchored
          positioning below. */}
      {typeof document !== 'undefined' && createPortal(
      <AnimatePresence>
        {expandedId && (() => {
          const vuln = displayVulns.find((v) => v.id === expandedId);
          if (!vuln) return null;
          // Scale in from wherever the click landed inside the (clamped) dialog
          // box, so the dialog visibly grows out of the clicked row.
          const origin = clickOrigin && modalPos
            ? `${clickOrigin.x - modalPos.left}px ${clickOrigin.y - modalPos.top}px`
            : '50% 50%';
          return (
            <Fragment key="drawer">
              {/* Sibling of the dialog, not an ancestor: backdrop-blur establishes a
                  new containing block for fixed-position descendants, which would
                  make the dialog's top/left resolve relative to this div instead
                  of the viewport. */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                onClick={() => setExpandedId(null)}
              />
              <motion.div
                ref={modalRef}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: modalPos ? 1 : 0, scale: modalPos ? 1 : 0.4 }}
                exit={{ opacity: 0, scale: 0.4 }}
                transition={{ type: 'spring', stiffness: 320, damping: 34 }}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                style={{
                  position: 'fixed',
                  left: modalPos ? modalPos.left : (clickOrigin?.x ?? 0),
                  top: modalPos ? modalPos.top : (clickOrigin?.y ?? 0),
                  transformOrigin: origin,
                  visibility: modalPos ? 'visible' : 'hidden',
                }}
                className="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl z-50 w-[calc(100vw-2rem)] max-w-[585px] max-h-[85vh] overflow-y-auto"
              >
                <div className="sticky top-0 bg-gray-900/95 backdrop-blur-sm border-b border-gray-700 rounded-t-2xl px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500">Vulnerability Details</p>
                    <h3 className="text-lg font-semibold text-white">{vuln.name}</h3>
                  </div>
                  <button
                    onClick={() => setExpandedId(null)}
                    className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-6 space-y-4 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium border" style={severityBadgeStyle(severityColors, vuln.severity)}>
                      {vuln.severity}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusColors[vuln.status] || statusColors.PENDING}`}>
                      {vuln.status}
                    </span>
                    {vuln.cvssScore != null && <span className="text-gray-400">CVSS {vuln.cvssScore}</span>}
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Description</p>
                    <p className="text-gray-300">{vuln.description}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Impact</p>
                    <p className="text-gray-300">{vuln.impact}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Remediation</p>
                    <p className="text-gray-300">{vuln.remediation}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">References</p>
                    <p className="text-gray-300 break-all">{vuln.references}</p>
                  </div>
                  {vuln.cvssVector && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">CVSS Vector</p>
                      <p className="text-gray-300">{stripCvssPrefix(vuln.cvssVector)}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    {(vuln.cveId || vuln.cweId) && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">CVE / CWE</p>
                        <p className="text-gray-300">
                          {vuln.cveId && <span className="text-cyan-400">{vuln.cveId}</span>}
                          {vuln.cveId && vuln.cweId && ' · '}
                          {vuln.cweId && <span className="text-violet-400">{vuln.cweId}</span>}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Category</p>
                      <p className="text-gray-300">{vuln.category === 'NETWORK' ? 'Network' : 'Application/API'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Source</p>
                      <p className="text-gray-300">{vuln.source || 'internal'}</p>
                    </div>
                    {vuln.reviewedBy?.username && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Reviewed By</p>
                        <p className="text-gray-300">{vuln.reviewedBy.username}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Created</p>
                      <p className="text-gray-300">{vuln.createdAt ? formatDateTime(vuln.createdAt) : '-'}</p>
                    </div>
                  </div>
                  <VulnHistoryTimeline vulnId={vuln.id} />
                </div>
              </motion.div>
            </Fragment>
          );
        })()}
      </AnimatePresence>,
      document.body
      )}

      {/* Add Modal */}
      {showAddModal && (
        <VulnModal
          onClose={() => setShowAddModal(false)}
          onSaved={() => { fetchVulnerabilities(); setShowAddModal(false); }}
          isRequest={user?.role !== 'ADMIN'}
        />
      )}

      {/* Edit Modal */}
      {showEditModal && editingVuln && (
        <VulnModal
          vuln={editingVuln}
          onClose={() => { setShowEditModal(false); setEditingVuln(null); }}
          onSaved={() => { fetchVulnerabilities(); fetchPending(); setShowEditModal(false); setEditingVuln(null); }}
          isRequest={false}
        />
      )}

      {/* Change Request Diff Modal */}
      {viewingChangeRequest && (
        <ChangeRequestDiffModal
          changeRequest={viewingChangeRequest}
          onClose={() => setViewingChangeRequest(null)}
        />
      )}

      {/* Bulk Upload Confirmation Modal */}
      {showBulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-md"
          >
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                </div>
                <h2 className="text-lg font-semibold text-white">{bulkMode === 'MERGE' ? 'Merge into Vulnerability Database?' : 'Replace Vulnerability Database?'}</h2>
              </div>
              <p className="text-gray-400 text-sm mb-4">
                {bulkMode === 'MERGE'
                  ? <>This will <span className="text-emerald-400 font-medium">add</span> the uploaded file's vulnerabilities to the category you select below and keep the existing ones. Vulnerabilities in the other category are not affected.</>
                  : <>This action will <span className="text-red-400 font-medium">permanently replace</span> the existing vulnerabilities in the category you select below with the uploaded CSV file. Vulnerabilities in the other category are not affected. This action cannot be undone.</>}
              </p>
              <div className="mb-6">
                <label className="block text-xs text-gray-400 mb-1">Category *</label>
                <select
                  value={bulkCategory}
                  onChange={(e) => setBulkCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm text-white"
                >
                  <option value="">Select category…</option>
                  <option value="APPLICATION_API">Application/API</option>
                  <option value="NETWORK">Network</option>
                </select>
              </div>
              <fieldset className="mb-6 space-y-2">
                <legend className="block text-xs text-gray-400 mb-1">Upload mode *</legend>
                {([
                  ['REPLACE', 'Replace completely', 'The category is emptied and filled with the file. Current entries not in the file are retired.'],
                  ['MERGE', 'Merge with existing', 'Current entries are kept and new names are added. If a name is repeated in the file or already exists, you choose which version to keep.'],
                ] as const).map(([value, label, hint]) => (
                  <label key={value} className={`flex gap-3 cursor-pointer rounded-lg border p-3 ${bulkMode === value ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-gray-700 hover:border-gray-600'}`}>
                    <input type="radio" name="bulk-mode" className="mt-1" checked={bulkMode === value} onChange={() => setBulkMode(value)} />
                    <span>
                      <span className="block text-sm text-white">{label}</span>
                      <span className="block text-xs text-gray-400">{hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setShowBulkConfirm(false); pendingFileRef.current = null; setBulkCategory(''); setBulkMode('REPLACE'); }}
                  className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={() => confirmBulkUpload()}
                  disabled={bulkUploading || !bulkCategory}
                  className={`px-4 py-2 rounded-lg text-white text-sm disabled:opacity-50 ${bulkMode === 'MERGE' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'}`}
                >
                  {bulkUploading ? 'Uploading...' : bulkMode === 'MERGE' ? 'Yes, Merge' : 'Yes, Replace Database'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Bulk Upload: names repeated in the file — pick the version to keep */}
      {bulkDuplicates.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-3xl max-h-[85vh] flex flex-col"
          >
            <div className="p-6 border-b border-gray-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Duplicate vulnerability names</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Nothing has been uploaded. Choose the version to keep for each name; the others are left out.</p>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-5 overflow-y-auto">
              {bulkDuplicates.map((d) => (
                <fieldset key={d.key} className="space-y-2">
                  <legend className="text-sm font-medium text-white mb-1">{d.name} <span className="text-gray-500 font-normal">({d.rows.length} in file{d.existing ? ', 1 already in database' : ''})</span></legend>
                  {d.existing && (
                    <label className={`block cursor-pointer rounded-lg border p-3 text-xs transition-all ${bulkChoices[d.key] === 0 ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-gray-700 hover:border-gray-600'}`}>
                      <span className="flex items-center gap-2 text-sm text-white">
                        <input type="radio" name={`dup-${d.key}`} checked={bulkChoices[d.key] === 0} onChange={() => setBulkChoices((c) => ({ ...c, [d.key]: 0 }))} />
                        Keep the existing entry · {d.existing.severity}{d.existing.cvssScore != null ? ` · CVSS ${d.existing.cvssScore}` : ''}{d.existing.cveId ? ` · ${d.existing.cveId}` : ''}
                      </span>
                      <span className="mt-1.5 block text-gray-300 line-clamp-3"><span className="text-gray-500">Description: </span>{d.existing.description}</span>
                      <span className="mt-1 block text-gray-400 line-clamp-2"><span className="text-gray-500">Remediation: </span>{d.existing.remediation}</span>
                    </label>
                  )}
                  {d.rows.map((r) => (
                    <label
                      key={r.row}
                      className={`block cursor-pointer rounded-lg border p-3 text-xs transition-all ${bulkChoices[d.key] === r.row ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-gray-700 hover:border-gray-600'}`}
                    >
                      <span className="flex items-center gap-2 text-sm text-white">
                        <input type="radio" name={`dup-${d.key}`} checked={bulkChoices[d.key] === r.row} onChange={() => setBulkChoices((c) => ({ ...c, [d.key]: r.row }))} />
                        Uploaded row {r.row} · {r.severity}{r.cvssScore != null ? ` · CVSS ${r.cvssScore}` : ''}{r.cveId ? ` · ${r.cveId}` : ''}{r.cweId ? ` · ${r.cweId}` : ''}
                      </span>
                      <span className="mt-1.5 block text-gray-300 line-clamp-3"><span className="text-gray-500">Description: </span>{r.description}</span>
                      <span className="mt-1 block text-gray-400 line-clamp-2"><span className="text-gray-500">Remediation: </span>{r.remediation}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <div className="p-4 border-t border-gray-800 flex items-center justify-between gap-3">
              <span className="text-xs text-gray-500">{Object.keys(bulkChoices).length} of {bulkDuplicates.length} chosen</span>
              <div className="flex gap-3">
                <button
                  onClick={() => { setBulkDuplicates([]); setBulkChoices({}); pendingFileRef.current = null; setBulkCategory(''); setBulkMode('REPLACE'); }}
                  className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={() => confirmBulkUpload(bulkChoices)}
                  disabled={bulkUploading || Object.keys(bulkChoices).length < bulkDuplicates.length}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm disabled:opacity-50"
                >
                  {bulkUploading ? 'Uploading...' : 'Keep selected & merge'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Bulk Upload Error Modal */}
      {showBulkError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-md"
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                    <XCircle className="w-5 h-5 text-red-400" />
                  </div>
                  <h2 className="text-lg font-semibold text-white">Upload Rejected</h2>
                </div>
                <button onClick={() => setShowBulkError(false)} className="p-1 rounded-lg hover:bg-gray-800 text-gray-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-gray-400 text-sm mb-4">
                {bulkErrorMsg}
              </p>
              <p className="text-gray-500 text-xs mb-6">
                Please make sure your file follows the exact format required (.csv or .xlsx, no macros/formulas). You can download a sample file below to see the correct structure.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowBulkError(false)}
                  className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
                >
                  Close
                </button>
                <button
                  onClick={downloadSampleCsv}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download Sample CSV
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

const CVSS_OPTIONS = {
  AV: [['N', 'Network'], ['A', 'Adjacent'], ['L', 'Local'], ['P', 'Physical']],
  AC: [['L', 'Low'], ['H', 'High']],
  PR: [['N', 'None'], ['L', 'Low'], ['H', 'High']],
  UI: [['N', 'None'], ['R', 'Required']],
  S: [['U', 'Unchanged'], ['C', 'Changed']],
  C: [['N', 'None'], ['L', 'Low'], ['H', 'High']],
  I: [['N', 'None'], ['L', 'Low'], ['H', 'High']],
  A: [['N', 'None'], ['L', 'Low'], ['H', 'High']],
} as const;

const CVSS_LABELS: Record<keyof typeof CVSS_OPTIONS, string> = {
  AV: 'Attack Vector', AC: 'Attack Complexity', PR: 'Privileges Req.', UI: 'User Interaction',
  S: 'Scope', C: 'Confidentiality', I: 'Integrity', A: 'Availability',
};

const CVSS_WEIGHTS = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  PR: { U: { N: 0.85, L: 0.62, H: 0.27 }, C: { N: 0.85, L: 0.68, H: 0.5 } },
  UI: { N: 0.85, R: 0.62 },
  CIA: { N: 0, L: 0.22, H: 0.56 },
} as const;

type CvssMetrics = { AV: string; AC: string; PR: string; UI: string; S: string; C: string; I: string; A: string };

function roundUpToTenth(n: number) {
  const int = Math.round(n * 100000);
  return int % 10000 === 0 ? int / 100000 : (Math.floor(int / 10000) + 1) / 10;
}

function calculateCvss(m: CvssMetrics) {
  const av = CVSS_WEIGHTS.AV[m.AV as keyof typeof CVSS_WEIGHTS.AV];
  const ac = CVSS_WEIGHTS.AC[m.AC as keyof typeof CVSS_WEIGHTS.AC];
  const pr = CVSS_WEIGHTS.PR[m.S as 'U' | 'C'][m.PR as keyof typeof CVSS_WEIGHTS.PR.U];
  const ui = CVSS_WEIGHTS.UI[m.UI as keyof typeof CVSS_WEIGHTS.UI];
  const c = CVSS_WEIGHTS.CIA[m.C as keyof typeof CVSS_WEIGHTS.CIA];
  const i = CVSS_WEIGHTS.CIA[m.I as keyof typeof CVSS_WEIGHTS.CIA];
  const a = CVSS_WEIGHTS.CIA[m.A as keyof typeof CVSS_WEIGHTS.CIA];

  const iscBase = 1 - (1 - c) * (1 - i) * (1 - a);
  const isc = m.S === 'U' ? 6.42 * iscBase : 7.52 * (iscBase - 0.029) - 3.25 * Math.pow(iscBase - 0.02, 15);
  const exploitability = 8.22 * av * ac * pr * ui;

  const score = isc <= 0 ? 0 : roundUpToTenth(
    m.S === 'U' ? Math.min(isc + exploitability, 10) : Math.min(1.08 * (isc + exploitability), 10)
  );
  const vector = `CVSS:3.1/AV:${m.AV}/AC:${m.AC}/PR:${m.PR}/UI:${m.UI}/S:${m.S}/C:${m.C}/I:${m.I}/A:${m.A}`;
  return { score, vector };
}

function parseCvssVector(vector?: string): CvssMetrics | null {
  if (!vector) return null;
  const parts = Object.fromEntries(vector.split('/').filter((p) => p.includes(':')).map((p) => p.split(':'))) as Record<string, string>;
  if (!parts.AV) return null;
  return { AV: parts.AV, AC: parts.AC, PR: parts.PR, UI: parts.UI, S: parts.S, C: parts.C, I: parts.I, A: parts.A };
}

function VulnModal({ vuln, onClose, onSaved, isRequest }: {
  vuln?: any;
  onClose: () => void;
  onSaved: () => void;
  isRequest: boolean;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const isTesterEditingExisting = !!vuln && user?.role === 'TESTER';
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: vuln?.name || '',
    severity: vuln?.severity || 'Medium',
    cvssScore: vuln?.cvssScore?.toString() || '',
    cvssVector: vuln?.cvssVector || '',
    cveId: vuln?.cveId || '',
    cweId: vuln?.cweId || '',
    description: vuln?.description || '',
    impact: vuln?.impact || '',
    remediation: vuln?.remediation || '',
    references: vuln?.references || '',
    category: vuln?.category || 'APPLICATION_API',
  });

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const [cvssMetrics, setCvssMetrics] = useState<CvssMetrics>(
    parseCvssVector(vuln?.cvssVector) || { AV: 'N', AC: 'L', PR: 'N', UI: 'N', S: 'U', C: 'N', I: 'N', A: 'N' }
  );

  useEffect(() => {
    const { score, vector } = calculateCvss(cvssMetrics);
    const severity =
      score >= 9 ? 'Critical' : score >= 7 ? 'High' : score >= 4 ? 'Medium' : score > 0 ? 'Low' : 'Info';
    setForm((f) => ({ ...f, cvssScore: score.toString(), cvssVector: vector, severity }));
  }, [cvssMetrics]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        cvssScore: form.cvssScore ? parseFloat(form.cvssScore) : undefined,
      };

      if (vuln && isTesterEditingExisting) {
        await api.post(`/vulnerabilities/${vuln.id}/change-request`, payload);
      } else if (vuln) {
        await api.put(`/vulnerabilities/${vuln.id}`, payload);
      } else if (isRequest) {
        await api.post('/vulnerabilities/request', payload);
      } else {
        await api.post('/vulnerabilities', payload);
      }
      onSaved();
      toast(
        isTesterEditingExisting
          ? 'Edit submitted for approval — original data unchanged until reviewed'
          : isRequest && !vuln ? 'Vulnerability requested for approval' : 'Vulnerability saved'
      );
    } catch (error: any) {
      toast(error.response?.data?.message || 'Failed to save', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm text-white';
  const labelCls = 'block text-xs text-gray-400 mb-1';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-700 sticky top-0 bg-gray-900 z-10">
          <h2 className="text-lg font-semibold text-white">
            {vuln ? 'Edit Vulnerability' : isRequest ? 'Request New Vulnerability' : 'Add New Vulnerability'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-800 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {isRequest && !vuln && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
              <AlertTriangle className="w-4 h-4 inline mr-2" />
              This vulnerability will be submitted for approval by Admin/Team Lead.
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Name *</label>
              <input type="text" required value={form.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Category *</label>
              <select value={form.category} onChange={(e) => set('category', e.target.value)} className={inputCls}>
                <option value="APPLICATION_API">Application/API</option>
                <option value="NETWORK">Network</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Severity *</label>
              <select value={form.severity} onChange={(e) => set('severity', e.target.value)} className={inputCls}>
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
                <option value="Info">Info</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>CVE ID</label>
              <input type="text" value={form.cveId}
                onChange={(e) => set('cveId', e.target.value)}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>CWE ID</label>
              <input type="text" value={form.cweId}
                onChange={(e) => set('cweId', e.target.value)}
                className={inputCls} />
            </div>
          </div>

          <div className="p-4 rounded-lg bg-gray-800/30 border border-gray-700 space-y-3">
            <p className="text-xs font-medium text-gray-300">CVSS v3.1 Calculator</p>
            <div className="grid grid-cols-4 gap-3">
              {(Object.keys(CVSS_OPTIONS) as (keyof typeof CVSS_OPTIONS)[]).map((key) => (
                <div key={key}>
                  <label className={labelCls}>{CVSS_LABELS[key]}</label>
                  <select value={cvssMetrics[key]} onChange={(e) => setCvssMetrics((m) => ({ ...m, [key]: e.target.value }))} className={inputCls}>
                    {CVSS_OPTIONS[key].map(([abbr, label]) => (
                      <option key={abbr} value={abbr}>{label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between pt-1 text-sm">
              <span className="text-gray-400">Score: <span className="text-white font-semibold">{form.cvssScore || '-'}</span></span>
              <span className="text-gray-400 truncate ml-4">Vector: <span className="text-cyan-400">{stripCvssPrefix(form.cvssVector)}</span></span>
            </div>
          </div>

          <div>
            <label className={labelCls}>Description *</label>
            <textarea value={form.description} rows={3} required
              onChange={(e) => set('description', e.target.value)}
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Impact *</label>
            <textarea value={form.impact} rows={2} required
              onChange={(e) => set('impact', e.target.value)}
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Remediation *</label>
            <textarea value={form.remediation} rows={2} required
              onChange={(e) => set('remediation', e.target.value)}
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>References *</label>
            <input type="text" value={form.references} required
              onChange={(e) => set('references', e.target.value)}
              className={inputCls} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm">Cancel</button>
            <button type="submit" disabled={submitting}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50">
              {submitting ? 'Saving...' : (vuln ? 'Update' : isRequest ? 'Submit Request' : 'Add Vulnerability')}
            </button>
          </div>
        </form>
      </motion.div>
    </div>,
    document.body
  );
}

const CHANGE_REQUEST_FIELD_LABELS: Record<string, string> = {
  name: 'Name', severity: 'Severity', cvssScore: 'CVSS', cvssVector: 'CVSS Vector',
  description: 'Description', impact: 'Impact', remediation: 'Remediation',
  references: 'Reference', cveId: 'CVE ID', cweId: 'CWE ID', category: 'Category',
};

function ChangeRequestDiffModal({ changeRequest, onClose }: { changeRequest: any; onClose: () => void }) {
  const before = changeRequest.beforeData || {};
  const after = changeRequest.afterData || {};
  const changedFields = Object.keys(after).filter((key) => String(before[key] ?? '') !== String(after[key] ?? ''));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-2xl max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-700 sticky top-0 bg-gray-900 z-10">
          <div>
            <h2 className="text-lg font-semibold text-white">Proposed Changes</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Requested by {changeRequest.requestedBy?.fullName || changeRequest.requestedBy?.username || 'Unknown'}
              {' · '}{formatDateTime(changeRequest.createdAt)}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-800 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {changedFields.length === 0 ? (
            <p className="text-sm text-gray-500">No field changes detected.</p>
          ) : (
            changedFields.map((field) => (
              <div key={field} className="p-3 rounded-lg bg-gray-800/50 border border-gray-700">
                <p className="text-xs font-medium text-gray-400 mb-2">{CHANGE_REQUEST_FIELD_LABELS[field] || field}</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[10px] uppercase text-gray-600 mb-1">Current</p>
                    <p className="text-red-300/90 whitespace-pre-wrap break-words">{field === 'cvssVector' ? stripCvssPrefix(before[field]) || '—' : String(before[field] ?? '—')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-gray-600 mb-1">Proposed</p>
                    <p className="text-emerald-300/90 whitespace-pre-wrap break-words">{field === 'cvssVector' ? stripCvssPrefix(after[field]) || '—' : String(after[field] ?? '—')}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

function VulnHistoryTimeline({ vulnId }: { vulnId: string }) {
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    api.get(`/vulnerabilities/${vulnId}/history`)
      .then((res) => setHistory(res.data))
      .catch(() => setHistory([]));
  }, [vulnId]);

  if (history.length === 0) return null;

  return (
    <div className="pt-2 border-t border-gray-800">
      <p className="text-xs text-gray-500 mb-3 flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" /> Activity Timeline
      </p>
      <div className="space-y-3">
        {history.map((log: any) => (
          <div key={log.id} className="flex items-start gap-2 text-xs">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
            <div>
              <p className="text-gray-300">
                <span className="font-medium text-white">{log.actor?.username || 'Deleted user'}</span>{' '}
                {log.action.replace('VULNERABILITY_', '').replace(/_/g, ' ').toLowerCase()}
              </p>
              <p className="text-gray-500">{formatDateTime(log.timestamp)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChangeTrackerTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/vulnerabilities/change-tracker')
      .then((res) => setLogs(res.data))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, []);

  const ACTION_STYLES: Record<string, string> = {
    VULNERABILITY_CREATED: 'bg-emerald-500/10 text-emerald-400',
    VULNERABILITY_UPDATED: 'bg-blue-500/10 text-blue-400',
    VULNERABILITY_DELETED: 'bg-red-500/10 text-red-400',
    VULNERABILITY_REQUESTED: 'bg-amber-500/10 text-amber-400',
    VULNERABILITY_APPROVED: 'bg-emerald-500/10 text-emerald-400',
    VULNERABILITY_REJECTED: 'bg-red-500/10 text-red-400',
  };

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-800">
        <h3 className="text-sm font-medium text-white flex items-center gap-2">
          <Clock className="w-4 h-4 text-purple-400" /> Vulnerability Change Tracker
        </h3>
        <p className="text-xs text-gray-500 mt-1">Every create, edit, delete, request, approval, and rejection across all vulnerabilities — admin-only.</p>
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-500 text-sm">Loading…</div>
      ) : logs.length === 0 ? (
        <div className="p-8 text-center text-gray-500 text-sm">No vulnerability changes recorded yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs border-b border-gray-800">
              <th className="px-5 py-2 font-medium">Timestamp</th>
              <th className="px-5 py-2 font-medium">Actor</th>
              <th className="px-5 py-2 font-medium">Action</th>
              <th className="px-5 py-2 font-medium">Vulnerability</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log: any) => (
              <tr key={log.id} className="border-b border-gray-800/60 hover:bg-white/[0.02]">
                <td className="px-5 py-2.5 text-gray-400 whitespace-nowrap">{formatDateTime(log.timestamp)}</td>
                <td className="px-5 py-2.5 text-white">{log.actor?.username || 'Deleted user'}</td>
                <td className="px-5 py-2.5">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${ACTION_STYLES[log.action] || 'bg-gray-500/10 text-gray-400'}`}>
                    {log.action.replace('VULNERABILITY_', '').replace(/_/g, ' ').toLowerCase()}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-gray-300">{log.vulnerabilityName || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
