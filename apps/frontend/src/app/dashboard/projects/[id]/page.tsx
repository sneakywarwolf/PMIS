'use client';
export const dynamic = 'force-dynamic';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Plus,
  Search,
  X,
  Loader2,
  ShieldAlert,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Save,
  FileText,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Eye,
} from 'lucide-react';
import { api, useAuth } from '@/contexts/auth-context';
import { TRANSITION_VARIANTS, TRANSITION_TIMING } from '@/lib/page-transitions';

const severityColors: Record<string, string> = {
  Critical: 'bg-red-500/10 text-red-400 border-red-500/20',
  High: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  Medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  Low: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Info: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-700 text-gray-300',
  SUBMITTED: 'bg-blue-900/50 text-blue-400',
  APPROVED: 'bg-emerald-900/50 text-emerald-400',
  REJECTED: 'bg-red-900/50 text-red-400',
};

const complianceStatusColors: Record<string, string> = {
  'Compliant': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'Non-Compliant': 'bg-red-500/10 text-red-400 border-red-500/20',
  'In-Progress': 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
};

interface Vulnerability {
  id: string;
  name: string;
  severity: string;
  cvssScore: number | null;
  cvssVector: string | null;
  description: string;
  impact: string;
  remediation: string;
  references: string;
  cveId: string | null;
  cweId: string | null;
}

interface PocStep {
  id?: string;
  stepNo: number;
  description: string;
  imagePath?: string | null;
}

interface Finding {
  id: string;
  projectId: string;
  vulnId: string;
  vulnerability: Vulnerability;
  testerNotes: string;
  evidencePaths: string[];
  status: string;
  affectedInstances: string[];
  authenticationType: string | null;
  proofOfConcept: string | null;
  vulnerabilityDependency: string | null;
  reportStatus: string;
  cvssScoreOverride: number | null;
  cvssVectorOverride: string | null;
  pocSteps: PocStep[];
  createdAt: string;
}

interface Project {
  id: string;
  name: string;
  clientName: string;
  scope: string;
  status: string;
  complianceStatus: string | null;
  startDate: string;
  endDate?: string;
  category: string;
  subType: string;
  appVersion?: string;
  location?: string;
  documentVersion?: string;
  toolsUsed?: string;
  testingEnvironment?: string;
  qaReviewerName?: string;
  applicationDetails?: string;
  testingType?: string;
  loginSystemTypes?: string;
  applicationNature?: string;
  testingLimitation?: string;
  complianceType?: string;
  tester: { id: string; username: string; email: string };
  tl: { id: string; username: string; email: string };
  template?: { id: string; name: string; projectType: string } | null;
  findings: Finding[];
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingFinding, setEditingFinding] = useState<Finding | null>(null);
  const [savingCompliance, setSavingCompliance] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportResult, setReportResult] = useState<any>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  const fetchProject = useCallback(async () => {
    try {
      const response = await api.get(`/projects/${id}`);
      setProject(response.data);
    } catch (error) {
      console.error('Failed to fetch project:', error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  const handleDeleteFinding = async (findingId: string) => {
    if (!confirm('Delete this finding?')) return;
    try {
      await api.delete(`/findings/${findingId}`);
      fetchProject();
    } catch (error) {
      console.error('Failed to delete finding:', error);
    }
  };

  const handleComplianceChange = async (newStatus: string) => {
    if (!project) return;
    setSavingCompliance(true);
    try {
      await api.put(`/projects/${project.id}`, { complianceStatus: newStatus });
      setProject({ ...project, complianceStatus: newStatus });
    } catch (error: any) {
      alert(error.response?.data?.message || 'Failed to update compliance status');
    } finally {
      setSavingCompliance(false);
    }
  };

  const handleGenerateIssueLog = async () => {
    if (!project) return;
    const findings = project.findings || [];
    const headers = ['S.No', 'Vulnerability', 'Severity', 'CVSS', 'Status', 'Tester Notes', 'Evidence'];
    let csv = headers.join(',') + '\n';
    findings.forEach((f: any, i: number) => {
      const v = f.vulnerability || {};
      const row = [
        i + 1,
        `"${(v.name || '').replace(/"/g, '""')}"`,
        v.severity || '',
        v.cvssScore ?? '',
        f.status || '',
        `"${(f.testerNotes || '').replace(/"/g, '""')}"`,
        `"${(f.evidencePaths || []).join('; ')}"`,
      ];
      csv += row.join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `issue-log-${project.name.replace(/\s+/g, '-').toLowerCase()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const handleGenerateReport = async () => {
    if (!project) return;
    setGeneratingReport(true);
    try {
      const response = await api.post('/reports/generate', { projectId: project.id });
      setReportResult(response.data);
    } catch (error: any) {
      alert(error.response?.data?.message || 'Report generation failed');
    } finally {
      setGeneratingReport(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">Project not found</p>
        <button
          onClick={() => router.push('/dashboard/projects')}
          className="mt-4 text-emerald-400 hover:text-emerald-300"
        >
          Back to Projects
        </button>
      </div>
    );
  }

  const canEditFindings = user?.role === 'ADMIN' || user?.role === 'AVP' || user?.role === 'TEAM_LEAD' || project.tester.id === user?.id;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/dashboard/projects')}
          className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-800 text-gray-400 transition-all"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">{project.name}</h1>
          <p className="text-gray-400 text-sm">{project.clientName}</p>
        </div>
      </div>

      {/* Report Result Toast */}
      <AnimatePresence>
        {reportResult && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="glass-card rounded-xl p-4 border border-emerald-500/30"
          >
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <div className="flex-1">
                <p className="text-sm text-white font-medium">Report Generated!</p>
                <p className="text-xs text-gray-400">{reportResult.findingsCount} findings included • {reportResult.fileName}</p>
              </div>
              <a
                href={reportResult.docxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
              >
                Download DOCX
              </a>
              <button
                onClick={() => setReportResult(null)}
                className="p-1 rounded-lg hover:bg-gray-800 text-gray-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Project Info Card */}
      <div className="glass-card rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Project Details</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEditModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-medium transition-all"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[project.status] || 'bg-gray-700 text-gray-300'}`}>
              {project.status.replace('_', ' ')}
            </span>
          </div>
        </div>

        {/* Compliance Status */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
          <span className="text-sm text-gray-400">Compliance Status:</span>
          {savingCompliance ? (
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
          ) : (
            <select
              value={project.complianceStatus || 'In-Progress'}
              onChange={(e) => handleComplianceChange(e.target.value)}
              className={`px-3 py-1 rounded-lg text-sm font-medium bg-gray-800 border border-gray-700 focus:border-emerald-500 outline-none ${
                complianceStatusColors[project.complianceStatus || 'In-Progress'] || ''
              }`}
            >
              <option value="Compliant">Compliant</option>
              <option value="Non-Compliant">Non-Compliant</option>
              <option value="In-Progress">In-Progress</option>
            </select>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <InfoField label="Start Date" value={new Date(project.startDate).toLocaleDateString()} />
          <InfoField label="End Date" value={project.endDate ? new Date(project.endDate).toLocaleDateString() : 'Not set'} />
          <InfoField label="Category" value={project.category} />
          <InfoField label="Sub Type" value={project.subType} />
          <InfoField label="App Version" value={project.appVersion || 'N/A'} />
          <InfoField label="Location" value={project.location || 'N/A'} />
          <InfoField label="Document Version" value={project.documentVersion || 'N/A'} />
          <InfoField label="Tools Used" value={project.toolsUsed || 'N/A'} />
          <InfoField label="Testing Environment" value={project.testingEnvironment || 'N/A'} />
          <InfoField label="QA Reviewer" value={project.qaReviewerName || 'N/A'} />
          <InfoField label="Testing Type" value={project.testingType || 'N/A'} />
          <InfoField label="Login Systems" value={project.loginSystemTypes || 'N/A'} />
          <InfoField label="Compliance Type" value={project.complianceType || 'N/A'} />
          <InfoField label="Tester" value={project.tester.username} />
          <InfoField label="Team Lead" value={project.tl.username} />
          <InfoField label="Template" value={project.template?.name || 'Default'} />
        </div>

        {project.scope && (
          <div className="pt-3 border-t border-gray-700/50">
            <p className="text-gray-500 text-xs mb-1">Scope</p>
            <p className="text-white text-sm whitespace-pre-wrap">{project.scope}</p>
          </div>
        )}
        {project.applicationDetails && (
          <div>
            <p className="text-gray-500 text-xs mb-1">Application Details</p>
            <p className="text-white text-sm whitespace-pre-wrap">{project.applicationDetails}</p>
          </div>
        )}
        {project.applicationNature && (
          <div>
            <p className="text-gray-500 text-xs mb-1">Application Nature</p>
            <p className="text-white text-sm whitespace-pre-wrap">{project.applicationNature}</p>
          </div>
        )}
        {project.testingLimitation && (
          <div>
            <p className="text-gray-500 text-xs mb-1">Testing Limitation</p>
            <p className="text-white text-sm whitespace-pre-wrap">{project.testingLimitation}</p>
          </div>
        )}
      </div>

      {/* Findings Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-lg font-semibold text-white">Findings ({project.findings.length})</h2>
          <div className="flex items-center gap-2">
            {canEditFindings && (
              <button
                onClick={() => { setEditingFinding(null); setShowAddModal(true); }}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-all text-sm"
              >
                <Plus className="w-4 h-4" />
                Add Finding
              </button>
            )}
            <button
              onClick={handleGenerateIssueLog}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/20 rounded-lg transition-all text-sm"
            >
              <AlertTriangle className="w-4 h-4" />
              Issue Log
            </button>
            <button
              onClick={handleGenerateReport}
              disabled={generatingReport}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/20 rounded-lg transition-all text-sm disabled:opacity-50"
            >
              {generatingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {generatingReport ? 'Generating...' : 'Report'}
            </button>
          </div>
        </div>

        {project.findings.length === 0 ? (
          <div className="text-center py-12 glass-card rounded-xl">
            <ShieldAlert className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No findings yet</p>
            {canEditFindings && (
              <button
                onClick={() => { setEditingFinding(null); setShowAddModal(true); }}
                className="mt-2 text-emerald-400 hover:text-emerald-300 text-sm"
              >
                Add your first finding
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {project.findings.map((finding, index) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                index={index}
                canEdit={canEditFindings}
                onEdit={() => { setEditingFinding(finding); setShowAddModal(true); }}
                onDelete={() => handleDeleteFinding(finding.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Finding Modal */}
      {showAddModal && (
        <FindingModal
          projectId={project.id}
          finding={editingFinding}
          onClose={() => { setShowAddModal(false); setEditingFinding(null); }}
          onSaved={() => { fetchProject(); setShowAddModal(false); setEditingFinding(null); }}
        />
      )}

      {/* Edit Project Modal */}
      {showEditModal && project && (
        <EditProjectModal
          project={project}
          onClose={() => setShowEditModal(false)}
          onSaved={() => { fetchProject(); setShowEditModal(false); }}
        />
      )}
    </div>
  );
}

function EditProjectModal({ project, onClose, onSaved }: { project: any; onClose: () => void; onSaved: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [customFields, setCustomFields] = useState<any[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>(project.customFieldValues || {});
  const [form, setForm] = useState({
    name: project.name,
    clientName: project.clientName,
    scope: project.scope || '',
    endDate: project.endDate ? new Date(project.endDate).toISOString().split('T')[0] : '',
    appVersion: project.appVersion || '',
    location: project.location || '',
    documentVersion: project.documentVersion || '',
    toolsUsed: project.toolsUsed || '',
    testingEnvironment: project.testingEnvironment || '',
    qaReviewerName: project.qaReviewerName || '',
    applicationDetails: project.applicationDetails || '',
    testingType: project.testingType || '',
    loginSystemTypes: project.loginSystemTypes || '',
    applicationNature: project.applicationNature || '',
    testingLimitation: project.testingLimitation || '',
    complianceType: project.complianceType || 'VAPT',
    templateId: project.template?.id || '',
  });

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const res = await api.get(`/reports/templates?category=${form.complianceType}`);
        setTemplates(res.data);
      } catch (error) {
        console.error('Failed to fetch templates:', error);
      }
    };
    fetchTemplates();
  }, [form.complianceType]);

  useEffect(() => {
    if (!form.templateId) {
      setCustomFields([]);
      return;
    }
    api.get(`/reports/templates/${form.templateId}/fields`)
      .then((res) => setCustomFields(res.data.filter((f: any) => f.isCustom)))
      .catch(() => setCustomFields([]));
  }, [form.templateId]);

  const setCustomFieldValue = (name: string, value: string) =>
    setCustomFieldValues((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload: any = { ...form, customFieldValues };
      if (!payload.templateId) payload.templateId = undefined;
      await api.put(`/projects/${project.id}`, payload);
      onSaved();
    } catch (error: any) {
      alert(error.response?.data?.message || 'Failed to update project');
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
        className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-3xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-700 sticky top-0 bg-gray-900 z-10">
          <h2 className="text-lg font-semibold text-white">Edit Project</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-800 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Project Name</label>
              <input type="text" required value={form.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Client Name</label>
              <input type="text" required value={form.clientName} onChange={(e) => set('clientName', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>App Version</label>
              <input type="text" value={form.appVersion} onChange={(e) => set('appVersion', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Location</label>
              <input type="text" value={form.location} onChange={(e) => set('location', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Document Version</label>
              <input type="text" value={form.documentVersion} onChange={(e) => set('documentVersion', e.target.value)} className={inputCls} placeholder="e.g. 1.0" />
            </div>
            <div>
              <label className={labelCls}>QA Reviewer Name</label>
              <input type="text" value={form.qaReviewerName} onChange={(e) => set('qaReviewerName', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Compliance Type</label>
              <select value={form.complianceType} onChange={(e) => set('complianceType', e.target.value)} className={inputCls}>
                <option value="VAPT">VAPT</option>
                <option value="CERT_IN">Cert-IN</option>
                <option value="PCI">PCI</option>
                <option value="ASV">ASV</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Report Template</label>
              <select value={form.templateId} onChange={(e) => set('templateId', e.target.value)} className={inputCls}>
                <option value="">{templates.length > 0 ? 'Select template' : 'No templates'}</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>End Date</label>
              <input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Tools Used</label>
              <input type="text" value={form.toolsUsed} onChange={(e) => set('toolsUsed', e.target.value)} className={inputCls} placeholder="Burp Suite Pro, Nmap..." />
            </div>
            <div>
              <label className={labelCls}>Testing Environment</label>
              <select value={form.testingEnvironment} onChange={(e) => set('testingEnvironment', e.target.value)} className={inputCls}>
                <option value="">Select</option>
                <option value="Staging">Staging</option>
                <option value="UAT">UAT</option>
                <option value="Pre-Prod">Pre-Prod</option>
                <option value="Production">Production</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Testing Approach</label>
              <select value={form.testingType} onChange={(e) => set('testingType', e.target.value)} className={inputCls}>
                <option value="">Select</option>
                <option value="Black Box">Black Box</option>
                <option value="Grey Box">Grey Box</option>
                <option value="White Box">White Box</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Types of Login System</label>
              <input type="text" value={form.loginSystemTypes} onChange={(e) => set('loginSystemTypes', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Scope</label>
            <textarea rows={2} value={form.scope} onChange={(e) => set('scope', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Application / Build Details</label>
            <textarea rows={2} value={form.applicationDetails} onChange={(e) => set('applicationDetails', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Nature / Purpose of the Application</label>
            <textarea rows={2} value={form.applicationNature} onChange={(e) => set('applicationNature', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Testing Limitation</label>
            <textarea rows={2} value={form.testingLimitation} onChange={(e) => set('testingLimitation', e.target.value)} className={inputCls} placeholder="Leave empty for N/A" />
          </div>

          {customFields.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-gray-700">
              <p className="text-sm font-medium text-gray-300 pt-2">Additional Template Fields</p>
              {customFields.map((field) => (
                <div key={field.id}>
                  <label className="block text-sm text-gray-300 mb-1">{field.name}</label>
                  <input
                    value={customFieldValues[field.normalizedName] || ''}
                    onChange={(e) => setCustomFieldValue(field.normalizedName, e.target.value)}
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-gray-500 text-xs">{label}</p>
      <p className="text-white font-medium">{value}</p>
    </div>
  );
}

function FindingCard({ finding, index, canEdit, onEdit, onDelete }: {
  finding: Finding;
  index: number;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cvss = finding.cvssScoreOverride ?? finding.vulnerability.cvssScore ?? '-';

  // PoC completion indicator (#5)
  const hasPocSteps = finding.pocSteps.length > 0;
  const hasPocDescriptions = finding.pocSteps.some(s => s.description.trim().length > 0);
  const pocComplete = hasPocSteps && hasPocDescriptions;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="glass-card rounded-xl overflow-hidden"
    >
      <div
        className="p-4 flex items-center gap-4 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center text-sm font-bold text-gray-400">
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-sm font-medium text-white truncate">{finding.vulnerability.name}</h3>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${severityColors[finding.vulnerability.severity] || severityColors.Info}`}>
              {finding.vulnerability.severity}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            CVSS: {cvss} {finding.cvssScoreOverride !== null && finding.cvssScoreOverride !== undefined && (
              <span className="text-amber-400">(overridden)</span>
            )}
            {finding.vulnerability.cveId && <span className="text-cyan-400 ml-2">{finding.vulnerability.cveId}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* PoC Indicator (#5) */}
          <span
            title={pocComplete ? 'POC steps added' : 'POC steps missing'}
            className={`p-1.5 rounded-lg transition-all ${
              pocComplete
                ? 'text-emerald-400 bg-emerald-500/10'
                : 'text-amber-400 bg-amber-500/10'
            }`}
          >
            {pocComplete ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          </span>
          {canEdit && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-2 border-t border-gray-700/50 space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Authentication Type</p>
                  <p className="text-white">{finding.authenticationType || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Report Status</p>
                  <p className="text-white">{finding.reportStatus}</p>
                </div>
              </div>
              {finding.affectedInstances.length > 0 && (
                <div>
                  <p className="text-gray-500 text-xs">Affected Instances</p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {finding.affectedInstances.map((inst, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-gray-800 text-xs text-gray-300">{inst}</span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="text-gray-500 text-xs">Description</p>
                <p className="text-gray-300 text-sm mt-1 whitespace-pre-wrap">{finding.vulnerability.description}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Impact</p>
                <p className="text-gray-300 text-sm mt-1 whitespace-pre-wrap">{finding.vulnerability.impact}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Remediation</p>
                <p className="text-gray-300 text-sm mt-1 whitespace-pre-wrap">{finding.vulnerability.remediation}</p>
              </div>
              {finding.testerNotes && (
                <div>
                  <p className="text-gray-500 text-xs">Tester Notes</p>
                  <p className="text-gray-300 text-sm mt-1 whitespace-pre-wrap">{finding.testerNotes}</p>
                </div>
              )}
              {finding.pocSteps.length > 0 && (
                <div>
                  <p className="text-gray-500 text-xs mb-2">POC Steps ({finding.pocSteps.length})</p>
                  <div className="space-y-2">
                    {finding.pocSteps.map((step) => (
                      <div key={step.id} className="flex gap-3 p-2 rounded-lg bg-gray-800/50">
                        <span className="w-6 h-6 rounded bg-emerald-500/10 text-emerald-400 text-xs flex items-center justify-center font-medium shrink-0">
                          {step.stepNo}
                        </span>
                        <div className="flex-1">
                          <p className="text-sm text-gray-300">{step.description}</p>
                          {step.imagePath && (
                            <p className="text-xs text-cyan-400 mt-1">Screenshot: {step.imagePath}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function FindingModal({ projectId, finding, onClose, onSaved }: {
  projectId: string;
  finding: Finding | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Vulnerability[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedVuln, setSelectedVuln] = useState<Vulnerability | null>(finding?.vulnerability || null);
  const searchRef = useRef<HTMLDivElement>(null);
  // New findings walk through Search -> Preview -> Configure as distinct steps
  // instead of one long scrolling form. Editing an existing finding skips
  // straight to Configure since the vulnerability is already fixed.
  const [step, setStep] = useState<'search' | 'configure'>(finding ? 'configure' : 'search');

  const [form, setForm] = useState({
    testerNotes: finding?.testerNotes || '',
    affectedInstances: finding?.affectedInstances?.join('\n') || '',
    authenticationType: finding?.authenticationType || '',
    proofOfConcept: finding?.proofOfConcept || '',
    vulnerabilityDependency: finding?.vulnerabilityDependency || '',
    reportStatus: finding?.reportStatus || 'Open',
    cvssScoreOverride: finding?.cvssScoreOverride?.toString() || '',
    cvssVectorOverride: finding?.cvssVectorOverride || '',
  });

  const [pocSteps, setPocSteps] = useState<PocStep[]>(
    finding?.pocSteps?.map(s => ({ ...s })) || []
  );
  const [uploadingStep, setUploadingStep] = useState<number | null>(null);
  const [showCvssCalc, setShowCvssCalc] = useState(false);

  const uploadStepImage = async (index: number, file: File) => {
    setUploadingStep(index);
    try {
      const data = new FormData();
      data.append('file', file);
      const res = await api.post('/findings/upload-poc-image', data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const updated = [...pocSteps];
      updated[index] = { ...updated[index], imagePath: res.data.path };
      setPocSteps(updated);
    } catch (error: any) {
      alert(error.response?.data?.message || 'Image upload failed');
    } finally {
      setUploadingStep(null);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Search vulnerabilities
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await api.get(`/vulnerabilities?search=${encodeURIComponent(searchQuery)}`);
        setSearchResults(response.data);
        setShowDropdown(true);
      } catch (error) {
        console.error('Search failed:', error);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const selectVulnerability = (vuln: Vulnerability) => {
    setSelectedVuln(vuln);
    setSearchQuery(vuln.name);
    setShowDropdown(false);
  };

  const goToConfigure = () => {
    if (!selectedVuln) return;
    setStep('configure');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVuln && !finding) {
      alert('Please select a vulnerability');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        projectId,
        vulnId: selectedVuln?.id || finding?.vulnId,
        testerNotes: form.testerNotes,
        affectedInstances: form.affectedInstances.split('\n').filter(s => s.trim()),
        authenticationType: form.authenticationType || undefined,
        proofOfConcept: form.proofOfConcept || undefined,
        vulnerabilityDependency: form.vulnerabilityDependency || undefined,
        reportStatus: form.reportStatus,
        cvssScoreOverride: form.cvssScoreOverride ? parseFloat(form.cvssScoreOverride) : undefined,
        cvssVectorOverride: form.cvssVectorOverride || undefined,
      };

      if (finding) {
        await api.put(`/findings/${finding.id}`, payload);
        const keptIds = new Set(pocSteps.filter(s => s.id && !s.id.startsWith('temp-')).map(s => s.id));
        for (const original of finding.pocSteps) {
          if (original.id && !keptIds.has(original.id)) {
            await api.delete(`/findings/${finding.id}/poc-steps/${original.id}`);
          }
        }
        for (const step of pocSteps) {
          if (step.id && !step.id.startsWith('temp-')) {
            await api.put(`/findings/${finding.id}/poc-steps/${step.id}`, {
              stepNo: step.stepNo,
              description: step.description,
              imagePath: step.imagePath ?? undefined,
            });
          } else {
            await api.post(`/findings/${finding.id}/poc-steps`, {
              stepNo: step.stepNo,
              description: step.description,
              imagePath: step.imagePath ?? undefined,
            });
          }
        }
      } else {
        const res = await api.post('/findings', payload);
        const newFindingId = res.data.id;
        for (const step of pocSteps) {
          await api.post(`/findings/${newFindingId}/poc-steps`, {
            stepNo: step.stepNo,
            description: step.description,
            imagePath: step.imagePath ?? undefined,
          });
        }
      }

      onSaved();
    } catch (error: any) {
      alert(error.response?.data?.message || 'Failed to save finding');
    } finally {
      setSubmitting(false);
    }
  };

  const addPocStep = () => {
    setPocSteps([...pocSteps, { stepNo: pocSteps.length + 1, description: '', id: `temp-${Date.now()}` }]);
  };

  const updatePocStep = (index: number, field: 'description', value: string) => {
    const updated = [...pocSteps];
    updated[index] = { ...updated[index], [field]: value };
    setPocSteps(updated);
  };

  const removePocStep = (index: number) => {
    const updated = pocSteps.filter((_, i) => i !== index);
    updated.forEach((s, i) => { s.stepNo = i + 1; });
    setPocSteps(updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-3xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-700 sticky top-0 bg-gray-900 z-10">
          <h2 className="text-lg font-semibold text-white">
            {finding ? 'Edit Finding' : 'Add Finding'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-800 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <AnimatePresence mode="wait">
            {step === 'search' && (
              <motion.div
                key="search"
                variants={TRANSITION_VARIANTS.scaleFade}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={TRANSITION_TIMING}
                className="space-y-4"
              >
                <div className="relative" ref={searchRef}>
                  <label className="block text-sm text-gray-300 mb-1">Search Vulnerability Database *</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Type to search vulnerabilities..."
                      className="w-full pl-10 pr-4 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm text-white"
                    />
                  </div>
                  {showDropdown && searchResults.length > 0 && (
                    <div className="absolute z-20 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                      {searchResults.map((vuln) => (
                        <button
                          key={vuln.id}
                          type="button"
                          onClick={() => selectVulnerability(vuln)}
                          className="w-full text-left px-4 py-2 hover:bg-gray-700 transition-colors border-b border-gray-700/50 last:border-0"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-white">{vuln.name}</span>
                            <span className={`px-1.5 py-0.5 rounded text-xs ${severityColors[vuln.severity] || severityColors.Info}`}>
                              {vuln.severity}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 truncate">CVSS: {vuln.cvssScore ?? '-'} {vuln.cveId}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Preview of the selected canonical vulnerability, before it
                    becomes a project-specific finding */}
                {selectedVuln && (
                  <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-3">
                    <div>
                      <p className="text-sm text-emerald-400 font-medium">{selectedVuln.name}</p>
                      <p className="text-xs text-gray-400 mt-1">{selectedVuln.description.substring(0, 200)}...</p>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div className="p-2 rounded bg-gray-800/50">
                        <span className="text-gray-500">Severity</span>
                        <p className="text-white">{selectedVuln.severity}</p>
                      </div>
                      <div className="p-2 rounded bg-gray-800/50">
                        <span className="text-gray-500">CVSS</span>
                        <p className="text-white">{selectedVuln.cvssScore ?? '-'}</p>
                      </div>
                      <div className="p-2 rounded bg-gray-800/50">
                        <span className="text-gray-500">CVE/CWE</span>
                        <p className="text-white">{selectedVuln.cveId || selectedVuln.cweId || '-'}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={goToConfigure}
                    disabled={!selectedVuln}
                    className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50"
                  >
                    Continue
                  </button>
                </div>
              </motion.div>
            )}

            {step === 'configure' && (
              <motion.div
                key="configure"
                variants={TRANSITION_VARIANTS.scaleFade}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={TRANSITION_TIMING}
                className="space-y-5"
              >

          {finding && (
            <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700">
              <p className="text-sm text-white font-medium">{finding.vulnerability.name}</p>
              <p className="text-xs text-gray-500">{finding.vulnerability.description.substring(0, 120)}...</p>
            </div>
          )}

          {selectedVuln && !finding && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 border border-gray-700">
              <div>
                <p className="text-sm text-white font-medium">{selectedVuln.name}</p>
                <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-xs ${severityColors[selectedVuln.severity] || severityColors.Info}`}>
                  {selectedVuln.severity}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setStep('search')}
                className="text-xs text-gray-400 hover:text-white underline"
              >
                Change vulnerability
              </button>
            </div>
          )}

          <div className="border border-gray-700 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">CVSS Override (optional)</h3>
              <button
                type="button"
                onClick={() => setShowCvssCalc(!showCvssCalc)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-600/20 text-cyan-400 text-xs hover:bg-cyan-600/30 transition-all"
              >
                <ShieldAlert className="w-3 h-3" />
                {showCvssCalc ? 'Hide Calculator' : 'CVSS Calculator'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">CVSS Score Override</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="10"
                  value={form.cvssScoreOverride}
                  onChange={(e) => setForm({ ...form, cvssScoreOverride: e.target.value })}
                  placeholder={selectedVuln?.cvssScore?.toString() || 'Default from DB'}
                  className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">CVSS Vector Override</label>
                <input
                  type="text"
                  value={form.cvssVectorOverride}
                  onChange={(e) => setForm({ ...form, cvssVectorOverride: e.target.value })}
                  placeholder={selectedVuln?.cvssVector || 'Default from DB'}
                  className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 text-sm text-white font-mono text-xs"
                />
              </div>
            </div>
            {showCvssCalc && (
              <CvssCalculator
                initialVector={form.cvssVectorOverride || selectedVuln?.cvssVector || ''}
                onApply={(score, vector) =>
                  setForm({ ...form, cvssScoreOverride: score.toString(), cvssVectorOverride: vector })
                }
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Authentication Type</label>
              <input
                type="text"
                value={form.authenticationType}
                onChange={(e) => setForm({ ...form, authenticationType: e.target.value })}
                placeholder="e.g. Form-based, OAuth, JWT"
                className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Report Status</label>
              <select
                value={form.reportStatus}
                onChange={(e) => setForm({ ...form, reportStatus: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 text-sm text-white"
              >
                <option value="Open">Open</option>
                <option value="Fixed">Fixed</option>
                <option value="Accepted Risk">Accepted Risk</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Affected Instances (one per line)</label>
            <textarea
              rows={3}
              value={form.affectedInstances}
              onChange={(e) => setForm({ ...form, affectedInstances: e.target.value })}
              placeholder="/api/v1/users&#10;https://example.com/login"
              className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 text-sm text-white"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Vulnerability Dependency</label>
            <input
              type="text"
              value={form.vulnerabilityDependency}
              onChange={(e) => setForm({ ...form, vulnerabilityDependency: e.target.value })}
              placeholder="e.g. Requires authentication bypass"
              className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 text-sm text-white"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Tester Notes</label>
            <textarea
              rows={3}
              value={form.testerNotes}
              onChange={(e) => setForm({ ...form, testerNotes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 text-sm text-white"
            />
          </div>

          <div className="border border-gray-700 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">POC Steps</h3>
              <button
                type="button"
                onClick={addPocStep}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-400 text-xs hover:bg-emerald-600/30 transition-all"
              >
                <Plus className="w-3 h-3" /> Add Step
              </button>
            </div>

            {pocSteps.length === 0 && (
              <p className="text-xs text-gray-500">No POC steps added yet.</p>
            )}

            <div className="space-y-2">
              {pocSteps.map((step, index) => (
                <div key={step.id || index} className="flex gap-3 items-start p-3 rounded-lg bg-gray-800/50">
                  <span className="w-7 h-7 rounded bg-emerald-500/10 text-emerald-400 text-xs flex items-center justify-center font-medium shrink-0 mt-1">
                    {step.stepNo}
                  </span>
                  <div className="flex-1 space-y-2">
                    <textarea
                      rows={2}
                      value={step.description}
                      onChange={(e) => updatePocStep(index, 'description', e.target.value)}
                      placeholder="Describe this step..."
                      className="w-full px-3 py-2 rounded-lg bg-gray-900/50 border border-gray-700 text-sm text-white"
                    />
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700 text-xs text-gray-300 hover:bg-gray-600 transition-all cursor-pointer">
                        {uploadingStep === index ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <ImageIcon className="w-3 h-3" />
                        )}
                        {step.imagePath ? 'Replace Screenshot' : 'Upload Screenshot'}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploadingStep !== null}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) uploadStepImage(index, file);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {step.imagePath && (
                        <span className="text-xs text-cyan-400">Screenshot attached</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePocStep(index)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all mt-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
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
              {submitting ? 'Saving...' : (finding ? 'Update Finding' : 'Add Finding')}
            </button>
          </div>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CVSS 3.1 Base Score Calculator
// ---------------------------------------------------------------------------

const CVSS_METRICS: { key: string; label: string; options: { v: string; l: string }[] }[] = [
  { key: 'AV', label: 'Attack Vector', options: [{ v: 'N', l: 'Network' }, { v: 'A', l: 'Adjacent' }, { v: 'L', l: 'Local' }, { v: 'P', l: 'Physical' }] },
  { key: 'AC', label: 'Attack Complexity', options: [{ v: 'L', l: 'Low' }, { v: 'H', l: 'High' }] },
  { key: 'PR', label: 'Privileges Required', options: [{ v: 'N', l: 'None' }, { v: 'L', l: 'Low' }, { v: 'H', l: 'High' }] },
  { key: 'UI', label: 'User Interaction', options: [{ v: 'N', l: 'None' }, { v: 'R', l: 'Required' }] },
  { key: 'S', label: 'Scope', options: [{ v: 'U', l: 'Unchanged' }, { v: 'C', l: 'Changed' }] },
  { key: 'C', label: 'Confidentiality', options: [{ v: 'N', l: 'None' }, { v: 'L', l: 'Low' }, { v: 'H', l: 'High' }] },
  { key: 'I', label: 'Integrity', options: [{ v: 'N', l: 'None' }, { v: 'L', l: 'Low' }, { v: 'H', l: 'High' }] },
  { key: 'A', label: 'Availability', options: [{ v: 'N', l: 'None' }, { v: 'L', l: 'Low' }, { v: 'H', l: 'High' }] },
];

const CVSS_WEIGHTS: Record<string, Record<string, number>> = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  PR_U: { N: 0.85, L: 0.62, H: 0.27 },
  PR_C: { N: 0.85, L: 0.68, H: 0.5 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
};

function cvssRoundup(x: number): number {
  const i = Math.round(x * 100000);
  if (i % 10000 === 0) return i / 100000;
  return (Math.floor(i / 10000) + 1) / 10;
}

function computeCvss31(m: Record<string, string>): number {
  const iscBase = (1 - CVSS_WEIGHTS.CIA[m.C]) * (1 - CVSS_WEIGHTS.CIA[m.I]) * (1 - CVSS_WEIGHTS.CIA[m.A]);
  const iss = 1 - iscBase;
  const impact = m.S === 'U'
    ? 6.42 * iss
    : 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
  const pr = CVSS_WEIGHTS[m.S === 'U' ? 'PR_U' : 'PR_C'][m.PR];
  const exploitability = 8.22 * CVSS_WEIGHTS.AV[m.AV] * CVSS_WEIGHTS.AC[m.AC] * pr * CVSS_WEIGHTS.UI[m.UI];
  if (impact <= 0) return 0;
  return m.S === 'U'
    ? cvssRoundup(Math.min(impact + exploitability, 10))
    : cvssRoundup(Math.min(1.08 * (impact + exploitability), 10));
}

function cvssSeverity(score: number): string {
  if (score >= 9.0) return 'Critical';
  if (score >= 7.0) return 'High';
  if (score >= 4.0) return 'Medium';
  if (score >= 0.1) return 'Low';
  return 'None';
}

function CvssCalculator({ initialVector, onApply }: {
  initialVector: string;
  onApply: (score: number, vector: string) => void;
}) {
  const parseVector = (v: string): Record<string, string> => {
    const defaults: Record<string, string> = { AV: 'N', AC: 'L', PR: 'N', UI: 'N', S: 'U', C: 'H', I: 'H', A: 'H' };
    const parts = v.split('/');
    for (const part of parts) {
      const [key, val] = part.split(':');
      if (key in defaults && val) defaults[key] = val;
    }
    return defaults;
  };

  const [metrics, setMetrics] = useState<Record<string, string>>(() => parseVector(initialVector));

  const vector = `CVSS:3.1/AV:${metrics.AV}/AC:${metrics.AC}/PR:${metrics.PR}/UI:${metrics.UI}/S:${metrics.S}/C:${metrics.C}/I:${metrics.I}/A:${metrics.A}`;
  const score = computeCvss31(metrics);
  const severity = cvssSeverity(score);

  return (
    <div className="rounded-lg bg-gray-900/60 border border-cyan-500/20 p-4 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {CVSS_METRICS.map((metric) => (
          <div key={metric.key}>
            <label className="block text-xs text-gray-400 mb-1">{metric.label}</label>
            <select
              value={metrics[metric.key]}
              onChange={(e) => setMetrics({ ...metrics, [metric.key]: e.target.value })}
              className="w-full px-2 py-1.5 rounded bg-gray-800 border border-gray-700 text-xs text-white"
            >
              {metric.options.map((opt) => (
                <option key={opt.v} value={opt.v}>{opt.l} ({opt.v})</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
        <div className="flex items-center gap-3">
          <span className={`text-lg font-bold ${
            severity === 'Critical' ? 'text-red-400' :
            severity === 'High' ? 'text-orange-400' :
            severity === 'Medium' ? 'text-yellow-400' :
            severity === 'Low' ? 'text-blue-400' : 'text-gray-400'
          }`}>
            {score.toFixed(1)} {severity}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onApply(score, vector)}
          className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-all"
        >
          Apply to Finding
        </button>
      </div>
      <p className="text-xs text-gray-500 font-mono break-all">{vector}</p>
    </div>
  );
}
