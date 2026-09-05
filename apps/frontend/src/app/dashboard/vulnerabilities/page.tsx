'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Search, Pencil, Trash2, X, Plus, Download, CheckCircle, XCircle, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, Upload } from 'lucide-react';
import { api, useAuth } from '@/contexts/auth-context';

const severityColors: Record<string, string> = {
  Critical: 'bg-red-500/10 text-red-400 border-red-500/20',
  High: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  Medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  Low: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Info: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

const statusColors: Record<string, string> = {
  APPROVED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  PENDING: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  REJECTED: 'bg-red-500/10 text-red-400 border-red-500/20',
};

interface SortConfig {
  field: string;
  order: 'asc' | 'desc';
}

export default function VulnerabilitiesPage() {
  const { user } = useAuth();
  const [vulnerabilities, setVulnerabilities] = useState<any[]>([]);
  const [pendingVulns, setPendingVulns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [sort, setSort] = useState<SortConfig>({ field: 'cvssScore', order: 'desc' });
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [editingVuln, setEditingVuln] = useState<any>(null);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'pending'>('all');

  // Bulk upload state
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [showBulkError, setShowBulkError] = useState(false);
  const [bulkErrorMsg, setBulkErrorMsg] = useState('');
  const [bulkUploading, setBulkUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<string | null>(null);

  const isAdminOrTL = user?.role === 'ADMIN' || user?.role === 'AVP' || user?.role === 'TEAM_LEAD';
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    fetchVulnerabilities();
    if (isAdminOrTL) fetchPending();
  }, [search, severity, sort, activeTab]);

  const fetchVulnerabilities = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (severity) params.set('severity', severity);
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
      const response = await api.get('/vulnerabilities/pending');
      setPendingVulns(response.data);
    } catch (error) {
      console.error('Failed to fetch pending:', error);
    }
  };

  const handleSort = (field: string) => {
    setSort(prev => ({
      field,
      order: prev.field === field && prev.order === 'desc' ? 'asc' : 'desc',
    }));
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deactivate this vulnerability?')) return;
    try {
      await api.delete(`/vulnerabilities/${id}`);
      fetchVulnerabilities();
      setMessage('Vulnerability deactivated');
    } catch (error) {
      console.error('Failed to delete vulnerability:', error);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await api.put(`/vulnerabilities/${id}/approve`);
      fetchPending();
      fetchVulnerabilities();
      setMessage('Vulnerability approved');
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Approval failed');
    }
  };

  const handleReject = async (id: string) => {
    try {
      await api.put(`/vulnerabilities/${id}/reject`);
      fetchPending();
      fetchVulnerabilities();
      setMessage('Vulnerability rejected');
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Rejection failed');
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
    if (!file) return;

    // Only CSV allowed
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setBulkErrorMsg('Only .csv files are allowed. Please upload a valid CSV file.');
      setShowBulkError(true);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const csv = event.target?.result as string;
      pendingFileRef.current = csv;
      setShowBulkConfirm(true);
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const confirmBulkUpload = async () => {
    if (!pendingFileRef.current) return;
    setBulkUploading(true);
    try {
      const response = await api.post('/vulnerabilities/bulk-upload', { csv: pendingFileRef.current });
      setMessage(response.data.message || `Successfully uploaded ${response.data.count} vulnerabilities.`);
      setShowBulkConfirm(false);
      pendingFileRef.current = null;
      fetchVulnerabilities();
    } catch (error: any) {
      const msg = error.response?.data?.message || 'Upload failed';
      setBulkErrorMsg(msg);
      setShowBulkError(true);
      setShowBulkConfirm(false);
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
    setMessage('');
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sort.field !== field) return <ArrowUpDown className="w-3 h-3 text-gray-600" />;
    return sort.order === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-400" /> : <ArrowDown className="w-3 h-3 text-emerald-400" />;
  };

  const displayVulns = activeTab === 'pending' ? pendingVulns : vulnerabilities;

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
          {isAdmin && (
            <>
              <input
                type="file"
                accept=".csv"
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

      {message && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className={`p-3 rounded-lg ${message.includes('success') || message.includes('approved') || message.includes('updated') || message.includes('Successfully') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
          {message}
        </motion.div>
      )}

      {/* Tabs */}
      {isAdminOrTL && (
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'all' ? 'bg-emerald-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:text-white'
            }`}
          >
            All ({vulnerabilities.length})
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
              activeTab === 'pending' ? 'bg-amber-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:text-white'
            }`}
          >
            Pending Approval
            {pendingVulns.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
                {pendingVulns.length}
              </span>
            )}
          </button>
        </div>
      )}

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
                <th className="px-4 py-3 text-sm font-medium text-gray-400">CVE / CWE</th>
                {activeTab === 'pending' && (
                  <th className="px-4 py-3 text-sm font-medium text-gray-400">Requested By</th>
                )}
                <th className="px-4 py-3 text-sm font-medium text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayVulns.map((vuln, i) => (
                <motion.tr
                  key={vuln.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className="border-b border-gray-700/50 hover:bg-white/5 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-white">{vuln.name}</p>
                      <p className="text-xs text-gray-500 truncate max-w-xs">{vuln.description}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${severityColors[vuln.severity] || severityColors.Info}`}>
                      {vuln.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-white">{vuln.cvssScore ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {vuln.cveId && <span className="text-cyan-400">{vuln.cveId}</span>}
                    {vuln.cweId && <span className="text-violet-400 ml-2">{vuln.cweId}</span>}
                  </td>
                  {activeTab === 'pending' && (
                    <td className="px-4 py-3 text-sm text-gray-400">{vuln.requestedBy?.username || 'Unknown'}</td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {activeTab === 'pending' && isAdminOrTL ? (
                        <>
                          <button
                            onClick={() => handleApprove(vuln.id)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
                            title="Approve"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleReject(vuln.id)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                            title="Reject"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => openEditModal(vuln)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 transition-all"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => openEditModal(vuln)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {user?.role === 'ADMIN' && (
                            <button
                              onClick={() => handleDelete(vuln.id)}
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
                <h2 className="text-lg font-semibold text-white">Replace Vulnerability Database?</h2>
              </div>
              <p className="text-gray-400 text-sm mb-6">
                This action will <span className="text-red-400 font-medium">permanently replace</span> the entire vulnerability database with the uploaded CSV file. All existing vulnerabilities will be deactivated and the new data will take their place. This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setShowBulkConfirm(false); pendingFileRef.current = null; }}
                  className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmBulkUpload}
                  disabled={bulkUploading}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm disabled:opacity-50"
                >
                  {bulkUploading ? 'Uploading...' : 'Yes, Replace Database'}
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
                  <h2 className="text-lg font-semibold text-white">Invalid CSV Format</h2>
                </div>
                <button onClick={() => setShowBulkError(false)} className="p-1 rounded-lg hover:bg-gray-800 text-gray-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-gray-400 text-sm mb-4">
                {bulkErrorMsg}
              </p>
              <p className="text-gray-500 text-xs mb-6">
                Please make sure your CSV file follows the exact format required. You can download a sample file below to see the correct structure.
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

function VulnModal({ vuln, onClose, onSaved, isRequest }: {
  vuln?: any;
  onClose: () => void;
  onSaved: () => void;
  isRequest: boolean;
}) {
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
  });

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        cvssScore: form.cvssScore ? parseFloat(form.cvssScore) : undefined,
      };

      if (vuln) {
        await api.put(`/vulnerabilities/${vuln.id}`, payload);
      } else if (isRequest) {
        await api.post('/vulnerabilities/request', payload);
      } else {
        await api.post('/vulnerabilities', payload);
      }
      onSaved();
    } catch (error: any) {
      alert(error.response?.data?.message || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm text-white';
  const labelCls = 'block text-xs text-gray-400 mb-1';

  return (
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

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>CVSS Score</label>
              <input type="number" step="0.1" min="0" max="10" value={form.cvssScore}
                onChange={(e) => set('cvssScore', e.target.value)}
                className={inputCls} />
            </div>
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
    </div>
  );
}
