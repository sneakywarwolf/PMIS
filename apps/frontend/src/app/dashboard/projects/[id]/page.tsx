'use client';
export const dynamic = 'force-dynamic';
import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  Download,
  Upload,
} from 'lucide-react';
import { api, useAuth } from '@/contexts/auth-context';
import { NetworkLimitationCaution } from '@/components/network-limitation-caution';
import { ScopeImportButton } from '@/components/scope-import-button';
import { triggerDownload } from '@/lib/download';
import { useConfirm } from '@/components/confirm-provider';
import { useToast } from '@/components/toast-provider';
import { PasswordGeneratorButton } from '@/components/password-generator-button';
import { NessusImportDialog } from '@/components/nessus-import-dialog';
import { ProjectFindingsImportDialog, IMPORT_MAX_BYTES } from '@/components/project-findings-import-dialog';
import { stripCvssPrefix } from '@/lib/cvss';
import { toDateInputValue, formatDate, formatDateTime } from '@/lib/datetime';
import { formatReportDate } from '@/lib/report-date';
import { TRANSITION_VARIANTS, TRANSITION_TIMING } from '@/lib/page-transitions';
import { useBranding } from '@/contexts/branding-context';

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
  // Only set on project-scoped (Nessus) records: nessus | calculated | unresolved.
  cvssVectorSource?: 'nessus' | 'calculated' | 'unresolved' | null;
  description: string;
  impact: string;
  remediation: string;
  references: string;
  cveId: string | null;
  cweId: string | null;
  category?: 'APPLICATION_API' | 'NETWORK';
}

interface PocStep {
  id?: string;
  stepNo: number;
  description: string;
  imagePath?: string | null;
  // Further PoCs of the step, in order; `imagePath` is the first.
  extraImagePaths?: string[];
}

/** A step's PoC images in order: the first one, then the rest. */
const stepImages = (s: PocStep): string[] => [s.imagePath, ...(s.extraImagePaths ?? [])].filter((p): p is string => !!p);
const withStepImages = (s: PocStep, list: string[]): PocStep => ({ ...s, imagePath: list[0] ?? null, extraImagePaths: list.slice(1) });
const MAX_POC_IMAGES = 20;
/** `poc/<uuid>_name.png` -> `name.png` */
const pocFileLabel = (path: string) => path.replace(/^poc\/[0-9a-f-]{36}_/, '');

interface Finding {
  id: string;
  projectId: string;
  vulnId: string;
  vulnerability: Vulnerability;
  // 'VA Finding' for scan imports (Nessus); null for findings from the Vulnerability DB.
  classification?: string | null;
  // 'VA' = Nessus import (project-scoped), 'PT' = added from the Vulnerability DB.
  findingType?: 'VA' | 'PT';
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
  pocComplete: boolean;
  pocReadiness: 'ready' | 'steps_missing' | 'poc_missing' | 'both_missing';
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
  startDateChangedAt?: string | null;
  endDate?: string;
  category: string;
  subType: string;
  appVersion?: string;
  location?: string;
  clientSpocName?: string;
  clientSpocDesignation?: string;
  clientSpocEmail?: string;
  documentVersion?: string;
  toolsUsed?: string;
  testingEnvironment?: string;
  qaReviewerName?: string;
  applicationDetails?: string;
  testingType?: string;
  loginSystemTypes?: string;
  applicationNature?: string;
  testingLimitation?: string;
  mobilePlatform?: string;
  sha1?: string;
  externalInternal?: string;
  networkActivityType?: string;
  totalScopeCount?: number;
  networkScope?: { ip: string; domainHostname: string; purpose: string }[];
  toolsUsedTable?: { name: string; version: string; licenseType: string }[];
  nmapPorts?: { ip: string; port: string; protocol: string; service: string; status: string }[];
  quarter?: string;
  complianceType?: string;
  tester: { id: string; username: string; email: string; fullName?: string | null };
  tl: { id: string; username: string; email: string; fullName?: string | null };
  template?: { id: string; name: string; projectType: string } | null;
  findings: Finding[];
  // Post-completion edits, oldest first. Only sent to Team Leads / Admins.
  changes?: ProjectChange[];
}

interface ProjectChange {
  id: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changedByName: string;
  changedAt: string;
}

const CHANGE_LABELS: Record<string, string> = {
  name: 'Project Name', clientName: 'Client', scope: 'Scope', startDate: 'Start Date', endDate: 'End Date',
  templateId: 'Template', complianceStatus: 'Compliance Status', complianceType: 'Compliance Type',
  appVersion: 'App Version', location: 'Location', clientSpocName: 'Client SPOC Name', clientSpocDesignation: 'Client SPOC Designation', clientSpocEmail: 'Client SPOC Email ID', documentVersion: 'Document Version',
  toolsUsedTable: 'Tools Used', testingEnvironment: 'Testing Environment', qaReviewerName: 'QA Reviewer',
  applicationDetails: 'Application Details', testingType: 'Testing Type', loginSystemTypes: 'Login Systems',
  applicationNature: 'Application Nature', testingLimitation: 'Testing Limitation', mobilePlatform: 'Android/iOS',
  sha1: 'SHA-1', externalInternal: 'Scope Exposure', networkActivityType: 'Network Activity Type',
  totalScopeCount: 'Total Scope Count', networkScope: 'Network Scope', quarter: 'Quarter/Frequency',
};

const REPORT_BLOCKED_MESSAGE = 'Add findings, or set the project status to Compliant, before generating a report.';

const changeLabel = (field: string) =>
  field.startsWith('customFieldValues.') ? field.slice('customFieldValues.'.length) : CHANGE_LABELS[field] || field;

const changeValue = (v: unknown) =>
  v === null || v === undefined ? 'empty' : typeof v === 'string' ? v : JSON.stringify(v);

export default function ProjectDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { settings: appSettings } = useBranding();
  const confirmDialog = useConfirm();
  const showToast = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingFinding, setEditingFinding] = useState<Finding | null>(null);
  const [savingCompliance, setSavingCompliance] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportResult, setReportResult] = useState<any>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showFormatMenu, setShowFormatMenu] = useState(false);
  const [nessusCount, setNessusCount] = useState(0);
  const [deletingNessus, setDeletingNessus] = useState(false);
  const [findingFilter, setFindingFilter] = useState<'ALL' | 'VA' | 'PT'>('ALL');

  const fetchProject = useCallback(async () => {
    try {
      const response = await api.get(`/projects/${id}`);
      setProject(response.data);
      // How many Nessus-imported VA findings the caller may bulk-delete (drives the "Delete All VA Findings" button).
      if (response.data.subType === 'NETWORK') {
        api.get(`/findings/project/${id}/nessus-count`).then((r) => setNessusCount(r.data.count)).catch(() => setNessusCount(0));
      }
    } catch (error) {
      console.error('Failed to fetch project:', error);
      showToast('Could not refresh project data — showing may be out of date', 'error');
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  // Deletes ALL of this project's Nessus-imported VA findings (server-side, every page / filter), after an explicit confirm.
  const handleDeleteAllNessus = async () => {
    if (!project) return;
    const ok = await confirmDialog({
      title: 'Delete all VA findings?',
      message: `This will permanently delete all ${nessusCount} Nessus-imported VA finding${nessusCount === 1 ? '' : 's'} in this project, with their POC steps. PT findings, the Vulnerability Database, Nmap ports, Network Scope and reports are not affected. This cannot be undone through the UI.`,
      confirmLabel: `Delete ${nessusCount} VA finding${nessusCount === 1 ? '' : 's'}`,
      danger: true,
    });
    if (!ok) return;
    setDeletingNessus(true);
    try {
      const res = await api.delete(`/findings/project/${project.id}/nessus`);
      showToast(res.data.deleted === 0 ? 'No Nessus-imported VA findings were left to delete.' : `Deleted ${res.data.deleted} Nessus-imported VA finding${res.data.deleted === 1 ? '' : 's'}.`, 'success');
    } catch (error: any) {
      showToast(error.response?.data?.message || 'Failed to delete VA findings — nothing was changed.', 'error');
    } finally {
      setDeletingNessus(false);
      await fetchProject();
    }
  };

  const handleDeleteFinding = async (findingId: string) => {
    const ok = await confirmDialog({ title: 'Delete finding?', message: 'This finding and its POC steps will be permanently deleted.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
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
    try {
      const { data } = await api.get(`/reports/issue-log/${project.id}`);
      const url = window.URL.createObjectURL(new Blob([data.csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = data.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      showToast(error.response?.data?.message || 'Failed to generate issue log', 'error');
    }
  };

  const nmapInputRef = useRef<HTMLInputElement>(null);
  const [uploadingNmap, setUploadingNmap] = useState(false);
  const handleNmapFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !project) return;
    setUploadingNmap(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post(`/projects/${project.id}/nmap-import`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      showToast(`Imported ${res.data.recordsImported} port(s) from Nmap scan.`, 'success');
      await fetchProject();
    } catch (error: any) {
      showToast(error.response?.data?.message || 'Failed to import Nmap scan', 'error');
    } finally {
      setUploadingNmap(false);
    }
  };

  const nessusInputRef = useRef<HTMLInputElement>(null);
  const [nessusFile, setNessusFile] = useState<File | null>(null);
  const handleNessusFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // Matches the server's limit for a .nessus or .csv scan export (it is read as it arrives and never stored);
    // checked here so nothing is uploaded just to be rejected.
    if (file.size > 500 * 1024 * 1024) {
      showToast('This file is larger than 500 MB, which is the upload limit.', 'error');
      return;
    }
    setNessusFile(file);
  };

  const handleGenerateReport = async (reportFormat: 'WORD' | 'EXCEL' = 'WORD') => {
    if (!project) return;
    setShowFormatMenu(false);
    setGeneratingReport(true);
    try {
      // Generation runs in a background queue so it doesn't block other
      // users generating reports at the same time — poll until it's done.
      const queued = await api.post('/reports/generate', reportFormat === 'EXCEL' ? { projectId: project.id, reportFormat } : { projectId: project.id });
      const reportId = queued.data.reportId;

      let status = queued.data.status;
      while (status === 'PENDING') {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const poll = await api.get(`/reports/generate/${reportId}/status`);
        status = poll.data.status;
        if (status === 'COMPLETED') {
          setReportResult(poll.data);
          if (poll.data.docxUrl) triggerDownload(poll.data.docxUrl, poll.data.fileName);
        } else if (status === 'FAILED') {
          alert(poll.data.error || 'Report generation failed');
        }
      }
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

  const changes = project.changes ?? [];
  const changesFor = (field: string) => changes.filter((c) => c.field === field);
  const reportReady = project.findings.length > 0 || project.complianceStatus === 'Compliant';
  const canEditFindings = user?.role === 'ADMIN' || user?.role === 'AVP' || user?.role === 'TEAM_LEAD' || project.tester.id === user?.id;

  const handleDeleteProject = async () => {
    const ok = await confirmDialog({
      title: 'Permanently delete project?',
      message: `"${project.name}" and all its findings, reports, PoCs/attachments, and issue logs will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Delete Permanently',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/projects/${project.id}`);
      showToast('Project permanently deleted', 'success');
      router.push('/dashboard/projects');
    } catch (error: any) {
      showToast(error.response?.data?.message || 'Failed to delete project', 'error');
    }
  };

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
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">{project.name}</h1>
          <p className="text-gray-400 text-sm">{project.clientName}</p>
        </div>
        {user?.role === 'ADMIN' && (
          <button
            onClick={handleDeleteProject}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-all text-sm"
            title="Permanently delete this project"
          >
            <Trash2 className="w-4 h-4" />
            Delete Project
          </button>
        )}
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
                <p className="text-xs text-gray-400">{reportResult.fileName} (v{reportResult.version})</p>
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
          <h2 className="text-lg font-semibold text-white">Project Details<ChangedMark changes={[...changesFor('name'), ...changesFor('clientName')]} /></h2>
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
          <div className="min-w-0">
            <p className="text-gray-500 text-xs">Start Date<ChangedMark changes={changesFor('startDate')} /></p>
            <p className="text-white font-medium flex items-center gap-1.5">
              {formatDate(project.startDate)}
              {user?.role !== 'TESTER' && project.startDateChangedAt && (
                <span title="Start date changed after project creation"><AlertTriangle className="w-3.5 h-3.5 text-amber-400" /></span>
              )}
            </p>
          </div>
          <InfoField label="End Date" value={project.endDate ? formatDate(project.endDate) : 'Not set'} changes={changesFor('endDate')} />
          <InfoField label="Sub Type" value={project.subType} />
          <InfoField label="App Version" value={project.appVersion || 'N/A'} changes={changesFor('appVersion')} />
          <InfoField label="Location" value={project.location || 'N/A'} changes={changesFor('location')} />
          {project.complianceType === 'CERT_IN' && (
            <>
          <InfoField label="Client SPOC Name" value={project.clientSpocName || 'N/A'} changes={changesFor('clientSpocName')} />
          <InfoField label="Client SPOC Designation" value={project.clientSpocDesignation || 'N/A'} changes={changesFor('clientSpocDesignation')} />
          <InfoField label="Client SPOC Email ID" value={project.clientSpocEmail || 'N/A'} changes={changesFor('clientSpocEmail')} />
            </>
          )}
          <InfoField label="Document Version" value={project.documentVersion || 'N/A'} changes={changesFor('documentVersion')} />
          {(!project.toolsUsedTable || project.toolsUsedTable.length === 0) && (
            <InfoField label="Tools Used" value={project.toolsUsed || 'N/A'} />
          )}
          <InfoField label="Testing Environment" value={project.testingEnvironment || 'N/A'} changes={changesFor('testingEnvironment')} />
          <InfoField label="QA Reviewer" value={project.qaReviewerName || 'N/A'} changes={changesFor('qaReviewerName')} />
          <InfoField label="Testing Type" value={project.testingType || 'N/A'} changes={changesFor('testingType')} />
          <InfoField label="Login Systems" value={project.loginSystemTypes || 'N/A'} changes={changesFor('loginSystemTypes')} />
          {project.subType === 'MOBILE' && (
            <InfoField label="Android/iOS" value={project.mobilePlatform || 'N/A'} changes={changesFor('mobilePlatform')} />
          )}
          {(project.subType === 'MOBILE' || project.subType === 'THICK_CLIENT') && (
            <InfoField label="SHA-1" value={project.sha1 || 'N/A'} changes={changesFor('sha1')} />
          )}
          {project.subType === 'NETWORK' && (
            <>
              <InfoField label="Scope Exposure" value={project.externalInternal || 'N/A'} changes={changesFor('externalInternal')} />
              <InfoField label="Network Activity Type" value={project.networkActivityType || 'N/A'} changes={changesFor('networkActivityType')} />
              <InfoField label="Total Scope Count" value={project.totalScopeCount != null ? String(project.totalScopeCount) : 'N/A'} changes={changesFor('totalScopeCount')} />
            </>
          )}
          <InfoField label="Quarter/Frequency" value={project.quarter || 'N/A'} changes={changesFor('quarter')} />
          <InfoField label="Compliance Type" value={project.complianceType || 'N/A'} changes={changesFor('complianceType')} />
          {user?.role !== 'TESTER' ? (
            <AssignedTesterField project={project} onChanged={fetchProject} />
          ) : (
            <InfoField label="Tester" value={project.tester.fullName || project.tester.username} />
          )}
          <InfoField label="Team Lead" value={project.tl.fullName || project.tl.username} />
          <InfoField label="Template" value={project.template?.name || 'None - no matching template uploaded'} changes={changesFor('templateId')} />
        </div>

        {changes.length > 0 && (
          <details className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <summary className="cursor-pointer text-amber-400 text-xs font-medium">
              Changed after completion — {new Set(changes.map((c) => c.field)).size} field(s), {changes.length} edit(s)
            </summary>
            <ul className="mt-2 space-y-1.5">
              {[...changes].reverse().map((c) => (
                <li key={c.id} className="text-xs text-gray-300">
                  <span className="font-medium text-white">{changeLabel(c.field)}</span>:{' '}
                  <span className="text-gray-400 break-all">{changeValue(c.oldValue)}</span> →{' '}
                  <span className="text-white break-all">{changeValue(c.newValue)}</span>
                  <span className="text-gray-500"> · {c.changedByName} · {formatDateTime(c.changedAt)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {project.scope && (
          <div className="pt-3 border-t border-gray-700/50">
            <p className="text-gray-500 text-xs mb-1">Scope<ChangedMark changes={changesFor('scope')} /></p>
            <p className="text-white text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{project.scope}</p>
          </div>
        )}
        {project.applicationDetails && (
          <div>
            <p className="text-gray-500 text-xs mb-1">Application Details<ChangedMark changes={changesFor('applicationDetails')} /></p>
            <p className="text-white text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{project.applicationDetails}</p>
          </div>
        )}
        {project.subType === 'NETWORK' && project.networkScope && project.networkScope.length > 0 && (
          <div className="pt-3 border-t border-gray-700/50">
            <p className="text-gray-500 text-xs mb-2">Network Scope<ChangedMark changes={changesFor('networkScope')} /></p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs">
                  <th className="text-left font-normal pb-1 w-12">S.No</th>
                  <th className="text-left font-normal pb-1">IP</th>
                  <th className="text-left font-normal pb-1">Domain/Hostname</th>
                  <th className="text-left font-normal pb-1">Purpose</th>
                </tr>
              </thead>
              <tbody>
                {project.networkScope.map((row, i) => (
                  <tr key={i} className="text-white border-t border-gray-800">
                    <td className="py-1 text-gray-400">{i + 1}</td>
                    <td className="py-1">{row.ip || 'NA'}</td>
                    <td className="py-1">{row.domainHostname || 'NA'}</td>
                    <td className="py-1">{row.purpose || 'NA'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {project.toolsUsedTable && project.toolsUsedTable.length > 0 && (
          <div className="pt-3 border-t border-gray-700/50">
            <p className="text-gray-500 text-xs mb-2">Tools Used<ChangedMark changes={changesFor('toolsUsedTable')} /></p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs">
                  <th className="text-left font-normal pb-1">Name</th>
                  <th className="text-left font-normal pb-1">Version</th>
                  <th className="text-left font-normal pb-1">Open Source/Licensed</th>
                </tr>
              </thead>
              <tbody>
                {project.toolsUsedTable.map((row, i) => (
                  <tr key={i} className="text-white border-t border-gray-800">
                    <td className="py-1">{row.name || 'NA'}</td>
                    <td className="py-1">{row.version || 'NA'}</td>
                    <td className="py-1">{row.licenseType || 'NA'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {project.subType === 'NETWORK' && project.nmapPorts && project.nmapPorts.length > 0 && (
          <div className="pt-3 border-t border-gray-700/50">
            <p className="text-gray-500 text-xs mb-2">Nmap Ports ({project.nmapPorts.length})</p>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs">
                    <th className="text-left font-normal pb-1">IP</th>
                    <th className="text-left font-normal pb-1">Port</th>
                    <th className="text-left font-normal pb-1">Protocol</th>
                    <th className="text-left font-normal pb-1">Service</th>
                    <th className="text-left font-normal pb-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {project.nmapPorts.map((row, i) => (
                    <tr key={i} className="text-white border-t border-gray-800">
                      <td className="py-1">{row.ip || 'NA'}</td>
                      <td className="py-1">{row.port || 'NA'}</td>
                      <td className="py-1">{row.protocol || 'NA'}</td>
                      <td className="py-1">{row.service || 'NA'}</td>
                      <td className="py-1">{row.status || 'NA'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {project.applicationNature && (
          <div>
            <p className="text-gray-500 text-xs mb-1">Application Nature</p>
            <p className="text-white text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{project.applicationNature}</p>
          </div>
        )}
        {project.testingLimitation && (
          <div>
            <p className="text-gray-500 text-xs mb-1">Testing Limitation</p>
            <p className="text-white text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{project.testingLimitation}</p>
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
            {canEditFindings && project.subType === 'NETWORK' && (
              <>
                <input
                  ref={nmapInputRef}
                  type="file"
                  accept=".xml,.txt,.nmap"
                  className="hidden"
                  onChange={handleNmapFileSelected}
                />
                <button
                  onClick={() => nmapInputRef.current?.click()}
                  disabled={uploadingNmap}
                  title="Upload Nmap port scan result (adds ports)"
                  className="flex items-center gap-2 px-4 py-2 bg-gray-700/50 hover:bg-gray-700 text-white rounded-lg transition-all text-sm disabled:opacity-50"
                >
                  {uploadingNmap ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Nmap Ports
                </button>
                <input
                  ref={nessusInputRef}
                  type="file"
                  accept=".nessus,.csv"
                  className="hidden"
                  onChange={handleNessusFileSelected}
                />
                <button
                  onClick={() => nessusInputRef.current?.click()}
                  title="Add VA findings here"
                  className="flex items-center gap-2 px-4 py-2 bg-gray-700/50 hover:bg-gray-700 text-white rounded-lg transition-all text-sm"
                >
                  <ShieldAlert className="w-4 h-4" />
                  Nessus
                </button>
                {nessusFile && (
                  <NessusImportDialog
                    projectId={project.id}
                    file={nessusFile}
                    onClose={() => setNessusFile(null)}
                    onImported={fetchProject}
                  />
                )}
              </>
            )}
            <button
              onClick={handleGenerateIssueLog}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/20 rounded-lg transition-all text-sm"
            >
              <AlertTriangle className="w-4 h-4" />
              Issue Log
            </button>
            <div className="relative">
              <button
                onClick={() => (project.subType === 'NETWORK' ? setShowFormatMenu((v) => !v) : handleGenerateReport())}
                disabled={generatingReport || !reportReady}
                title={reportReady ? undefined : REPORT_BLOCKED_MESSAGE}
                aria-haspopup={project.subType === 'NETWORK' ? 'menu' : undefined}
                aria-expanded={project.subType === 'NETWORK' ? showFormatMenu : undefined}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/20 rounded-lg transition-all text-sm disabled:opacity-50"
              >
                {generatingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                {generatingReport ? 'Generating...' : 'Report'}
                {project.subType === 'NETWORK' && !generatingReport && <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {project.subType === 'NETWORK' && showFormatMenu && (
                <div role="menu" className="absolute right-0 mt-1 z-20 w-56 rounded-lg border border-gray-700 bg-gray-900 shadow-xl overflow-hidden">
                  <button role="menuitem" onClick={() => handleGenerateReport('WORD')} className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-white/5">
                    Word Report (.docx)
                  </button>
                  <button role="menuitem" onClick={() => handleGenerateReport('EXCEL')} className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-white/5 border-t border-gray-800">
                    Excel Report (.xlsx)
                  </button>
                </div>
              )}
            </div>
            <PasswordGeneratorButton />
          </div>
        </div>

        {project.subType === 'NETWORK' && (
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter findings">
            {(['ALL', 'VA', 'PT'] as const).map((key) => {
              const count = key === 'ALL' ? project.findings.length : project.findings.filter((f) => f.findingType === key).length;
              const label = key === 'ALL' ? 'All' : key === 'VA' ? 'VA Findings' : 'PT Findings';
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={findingFilter === key}
                  onClick={() => setFindingFilter(key)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                    findingFilter === key
                      ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30'
                      : 'bg-gray-800/50 text-gray-400 border-gray-700 hover:text-white'
                  }`}
                >
                  {label} ({count})
                </button>
              );
            })}
            {canEditFindings && nessusCount > 0 && (
              <button
                onClick={handleDeleteAllNessus}
                disabled={deletingNessus}
                title="Permanently delete every Nessus-imported VA finding in this project"
                className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/20 rounded-lg transition-all text-sm disabled:opacity-50"
              >
                {deletingNessus ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete All VA Findings ({nessusCount})
              </button>
            )}
          </div>
        )}

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
            {(project.subType === 'NETWORK' && findingFilter !== 'ALL'
              ? project.findings.filter((f) => f.findingType === findingFilter)
              : project.findings
            ).map((finding, index) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                index={index}
                canEdit={canEditFindings}
                network={project.subType === 'NETWORK'}
                typeIndicator={project.subType === 'NETWORK' && findingFilter === 'ALL' ? finding.findingType ?? null : null}
                onEdit={() => { setEditingFinding(finding); setShowAddModal(true); }}
                onDelete={() => handleDeleteFinding(finding.id)}
              />
            ))}
          </div>
        )}
      </div>

      <GeneratedReportsSection
        projectId={project.id}
        refreshKey={reportResult}
        canDelete={user?.role === 'ADMIN' || user?.id === project.tester.id}
      />

      {/* Add/Edit Finding Modal */}
      {showAddModal && (
        <FindingModal
          projectId={project.id}
          finding={editingFinding}
          onClose={() => { setShowAddModal(false); setEditingFinding(null); }}
          onSaved={async () => { await fetchProject(); setShowAddModal(false); setEditingFinding(null); }}
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
  const [customFields, setCustomFields] = useState<any[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>(project.customFieldValues || {});
  const [form, setForm] = useState({
    name: project.name,
    clientName: project.clientName,
    scope: project.scope || '',
    endDate: project.endDate ? toDateInputValue(project.endDate) : '',
    appVersion: project.appVersion || '',
    location: project.location || '',
    clientSpocName: project.clientSpocName || '',
    clientSpocDesignation: project.clientSpocDesignation || '',
    clientSpocEmail: project.clientSpocEmail || '',
    documentVersion: project.documentVersion || '',
    toolsUsed: project.toolsUsed || '',
    testingEnvironment: project.testingEnvironment || '',
    qaReviewerName: project.qaReviewerName || '',
    applicationDetails: project.applicationDetails || '',
    testingType: project.testingType || '',
    loginSystemTypes: project.loginSystemTypes || '',
    applicationNature: project.applicationNature || '',
    testingLimitation: project.testingLimitation || '',
    mobilePlatform: project.mobilePlatform || '',
    sha1: project.sha1 || '',
    externalInternal: project.externalInternal || '',
    networkActivityType: project.networkActivityType || '',
    totalScopeCount: project.totalScopeCount != null ? String(project.totalScopeCount) : '',
    quarter: project.quarter || '',
    complianceType: project.complianceType || 'VAPT',
  });

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  // Defends against rows saved before a past validation bug, which could
  // store malformed entries (e.g. []) instead of {ip, domainHostname, purpose}.
  const [networkScope, setNetworkScope] = useState<{ ip: string; domainHostname: string; purpose: string }[]>(
    (project.networkScope || []).map((r: any) => ({
      ip: r?.ip || '',
      domainHostname: r?.domainHostname || '',
      purpose: r?.purpose || '',
    })),
  );
  // Imported rows are appended after any rows the user has actually filled in (untouched blank rows are dropped).
  const importScopeRows = (added: { ip: string; domainHostname: string; purpose: string }[]) =>
    setNetworkScope((rows) => [...rows.filter((r) => r.ip || r.domainHostname || r.purpose), ...added]);
  const addScopeRow = () => setNetworkScope((rows) => [...rows, { ip: '', domainHostname: '', purpose: '' }]);
  const removeScopeRow = (i: number) => setNetworkScope((rows) => rows.filter((_, idx) => idx !== i));
  const setScopeRow = (i: number, key: 'ip' | 'domainHostname' | 'purpose', value: string) =>
    setNetworkScope((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  const [toolsUsedTable, setToolsUsedTable] = useState<{ name: string; version: string; licenseType: string }[]>(
    (project.toolsUsedTable || []).map((r: any) => ({
      name: r?.name || '',
      version: r?.version || '',
      licenseType: r?.licenseType || 'Open Source',
    })),
  );
  const addToolRow = () => setToolsUsedTable((rows) => [...rows, { name: '', version: '', licenseType: 'Open Source' }]);
  const removeToolRow = (i: number) => setToolsUsedTable((rows) => rows.filter((_, idx) => idx !== i));
  const setToolRow = (i: number, key: 'name' | 'version' | 'licenseType', value: string) =>
    setToolsUsedTable((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  // Network projects have no "Project Name" field — the project still
  // needs an identifying name (project lists, file names), so derive one
  // from client + quarter instead of asking for it.
  useEffect(() => {
    if (project.subType !== 'NETWORK') return;
    const derived = [form.clientName, 'Network', form.quarter].filter(Boolean).join(' - ');
    if (derived && derived !== form.name) set('name', derived);
  }, [project.subType, form.clientName, form.quarter]);

  useEffect(() => {
    if (!project.template?.id) {
      setCustomFields([]);
      return;
    }
    api.get(`/reports/templates/${project.template.id}/fields`)
      .then((res) => setCustomFields(res.data.filter((f: any) => f.isCustom)))
      .catch(() => setCustomFields([]));
  }, [project.template?.id]);

  const setCustomFieldValue = (name: string, value: string) =>
    setCustomFieldValues((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload: any = { ...form, customFieldValues };
      payload.totalScopeCount = form.totalScopeCount ? parseInt(form.totalScopeCount, 10) : undefined;
      if (project.subType === 'NETWORK') payload.networkScope = networkScope;
      payload.toolsUsedTable = toolsUsedTable;
      await api.put(`/projects/${project.id}`, payload);
      onSaved();
    } catch (error: any) {
      alert(error.response?.data?.message || 'Failed to update project');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full min-w-0 px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm text-white';
  const labelCls = 'block text-xs text-gray-400 mb-1';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-5xl max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-700 sticky top-0 bg-gray-900 z-10">
          <h2 className="text-lg font-semibold text-white">Edit Project</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-800 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Testing Type (Platform) is fixed at creation and not editable here;
                Compliance Category leads the form to mirror the creation dialog's
                field order as closely as an immutable subType allows. */}
            <div>
              <label className={labelCls}>Compliance Type</label>
              <select value={form.complianceType} onChange={(e) => set('complianceType', e.target.value)} className={inputCls}>
                <option value="VAPT">VAPT</option>
                <option value="CERT_IN">Cert-IN</option>
                <option value="PCI">PCI</option>
                <option value="ASV">ASV</option>
              </select>
            </div>
            {project.subType !== 'NETWORK' && (
              <div>
                <label className={labelCls}>Project Name</label>
                <input type="text" required value={form.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
              </div>
            )}
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
            {form.complianceType === 'CERT_IN' && (
              <>
            <div>
              <label className={labelCls}>Client SPOC Name</label>
              <input type="text" value={form.clientSpocName} onChange={(e) => set('clientSpocName', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Client SPOC Designation</label>
              <input type="text" value={form.clientSpocDesignation} onChange={(e) => set('clientSpocDesignation', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Client SPOC Email ID</label>
              <input type="email" value={form.clientSpocEmail} onChange={(e) => set('clientSpocEmail', e.target.value)} className={inputCls} />
            </div>
              </>
            )}
            <div>
              <label className={labelCls}>Document Version</label>
              <input type="text" value={form.documentVersion} onChange={(e) => set('documentVersion', e.target.value)} className={inputCls} placeholder="e.g. 1.0" />
            </div>
            <div>
              <label className={labelCls}>QA Reviewer Name</label>
              <input type="text" value={form.qaReviewerName} onChange={(e) => set('qaReviewerName', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>End Date</label>
              <input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} className={inputCls} />
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
            {project.subType !== 'NETWORK' && (
              <div>
                <label className={labelCls}>Types of Login System</label>
                <input type="text" value={form.loginSystemTypes} onChange={(e) => set('loginSystemTypes', e.target.value)} className={inputCls} />
              </div>
            )}
            {project.subType === 'MOBILE' && (
              <div>
                <label className={labelCls}>Android/iOS</label>
                <select value={form.mobilePlatform} onChange={(e) => set('mobilePlatform', e.target.value)} className={inputCls}>
                  <option value="">Select platform</option>
                  <option value="Android">Android</option>
                  <option value="iOS">iOS</option>
                </select>
              </div>
            )}
            {(project.subType === 'MOBILE' || project.subType === 'THICK_CLIENT') && (
              <div>
                <label className={labelCls}>SHA-1</label>
                <input type="text" value={form.sha1} onChange={(e) => set('sha1', e.target.value)} className={inputCls} />
              </div>
            )}
            {project.subType === 'NETWORK' && (
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

          {project.subType === 'NETWORK' && (
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

          {project.subType !== 'NETWORK' && (
            <div>
              <label className={labelCls}>Scope</label>
              <textarea rows={2} value={form.scope} onChange={(e) => set('scope', e.target.value)} className={inputCls} />
            </div>
          )}
          {project.subType !== 'NETWORK' && (
            <div>
              <label className={labelCls}>Application / Build Details</label>
              <textarea rows={2} value={form.applicationDetails} onChange={(e) => set('applicationDetails', e.target.value)} className={inputCls} />
            </div>
          )}
          <div>
            <label className={labelCls}>Quarter/Frequency</label>
            <input type="text" value={form.quarter} onChange={(e) => set('quarter', e.target.value)} className={inputCls} placeholder="e.g. Q1, H1, Annually, Half-yearly" />
          </div>
          {project.subType !== 'NETWORK' && (
            <div>
              <label className={labelCls}>Nature / Purpose of the Application</label>
              <textarea rows={8} value={form.applicationNature} onChange={(e) => set('applicationNature', e.target.value)} className={`${inputCls} min-h-[10rem] max-h-[60vh] resize-y`} />
            </div>
          )}
          <div>
            <label className={labelCls}>Testing Limitation</label>
            <textarea rows={8} value={form.testingLimitation} onChange={(e) => set('testingLimitation', e.target.value)} className={`${inputCls} min-h-[10rem] max-h-[60vh] resize-y`} placeholder="Leave empty for N/A" />
            {project.subType === 'NETWORK' && <NetworkLimitationCaution />}
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
    </div>,
    document.body
  );
}

// Admin: every active tester. TL/AVP: GET /users already returns only their own team, and the
// server re-checks the team on save.
function AssignedTesterField({ project, onChanged }: {
  project: { id: string; tester: { id: string; username: string; fullName?: string | null } };
  onChanged: () => void;
}) {
  const showToast = useToast();
  const [editing, setEditing] = useState(false);
  const [testers, setTesters] = useState<{ id: string; username: string; fullName?: string | null }[]>([]);
  const [selected, setSelected] = useState(project.tester.id);
  const [saving, setSaving] = useState(false);

  const startEditing = async () => {
    try {
      const { data } = await api.get('/users');
      setTesters(data.filter((u: any) => u.role === 'TESTER' && u.isActive && !u.deletedAt));
      setSelected(project.tester.id);
      setEditing(true);
    } catch {
      showToast('Could not load testers', 'error');
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/projects/${project.id}/reassign`, { testerId: selected });
      showToast('Tester reassigned', 'success');
      setEditing(false);
      onChanged();
    } catch (e: any) {
      showToast(e.response?.data?.message || 'Could not reassign project', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div>
        <p className="text-gray-500 text-xs">Assigned Tester</p>
        <p className="text-white font-medium">
          {project.tester.fullName || project.tester.username}{' '}
          <button onClick={startEditing} className="ml-1 text-xs text-emerald-400 hover:text-emerald-300">Change</button>
        </p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-gray-500 text-xs">Assigned Tester</p>
      <div className="flex items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="px-2 py-1 rounded-lg text-sm bg-gray-800 border border-gray-700 focus:border-emerald-500 outline-none text-white"
        >
          {!testers.some((t) => t.id === project.tester.id) && (
            <option value={project.tester.id}>{project.tester.fullName || project.tester.username}</option>
          )}
          {testers.map((t) => (
            <option key={t.id} value={t.id}>{t.fullName || t.username}</option>
          ))}
        </select>
        <button onClick={save} disabled={saving || selected === project.tester.id} className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50">Save</button>
        <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:text-gray-300">Cancel</button>
      </div>
    </div>
  );
}

function ChangedMark({ changes }: { changes: ProjectChange[] }) {
  if (!changes.length) return null;
  const last = changes[changes.length - 1];
  return (
    <span title={`Changed after completion (${changes.length}×). Latest: ${changeValue(last.oldValue)} → ${changeValue(last.newValue)}`}>
      <Pencil className="inline w-3 h-3 ml-1 text-amber-400" aria-label="Changed after completion" />
    </span>
  );
}

function InfoField({ label, value, changes = [] }: { label: string; value: string; changes?: ProjectChange[] }) {
  return (
    <div className="min-w-0">
      <p className="text-gray-500 text-xs">{label}<ChangedMark changes={changes} /></p>
      <p className="text-white font-medium break-words [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}

function FindingCard({ finding, index, canEdit, network, typeIndicator, onEdit, onDelete }: {
  finding: Finding;
  index: number;
  canEdit: boolean;
  // Network projects: show CVSS vector and CVE IDs, and the VA/PT indicator instead of the classification badge.
  network: boolean;
  // 'VA' | 'PT' only while the All tab is selected; null under a VA/PT tab (the tab already says which).
  typeIndicator: 'VA' | 'PT' | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cvss = finding.cvssScoreOverride ?? finding.vulnerability.cvssScore ?? '-';

  // PoC completion indicator — backend getPocReadiness is the single source of truth
  const pocComplete = finding.pocComplete;
  const pocIndicatorText: Record<Finding['pocReadiness'], string> = {
    ready: 'Steps/POC Present',
    steps_missing: 'Steps Missing',
    poc_missing: 'PoC Missing',
    both_missing: 'Steps & PoC Missing',
  };

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
            {!network && finding.classification && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium border bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                {finding.classification}
              </span>
            )}
            {typeIndicator && (
              <span
                title={typeIndicator === 'VA' ? 'VA finding (imported from a Nessus scan)' : 'PT finding (added from the Vulnerability DB)'}
                className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${
                  typeIndicator === 'VA'
                    ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                    : 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                }`}
              >
                {typeIndicator}
              </span>
            )}
            {finding.vulnerability.cvssVectorSource === 'calculated' && (
              <span
                title={`Calculated from the imported score and the project's exposure; several vectors can give this score. Review before relying on it.\n${stripCvssPrefix(finding.vulnerability.cvssVector)}`}
                className="px-2 py-0.5 rounded-full text-xs font-medium border bg-amber-500/10 text-amber-400 border-amber-500/20"
              >
                CVSS vector: calculated, review
              </span>
            )}
            {finding.vulnerability.cvssVectorSource === 'unresolved' && (
              <span
                title="No vector in the scan, and none could be determined from the score and the project's exposure."
                className="px-2 py-0.5 rounded-full text-xs font-medium border bg-gray-500/10 text-gray-400 border-gray-500/20"
              >
                CVSS vector: unresolved
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            CVSS: {cvss} {finding.cvssScoreOverride !== null && finding.cvssScoreOverride !== undefined && (
              <span className="text-amber-400">(overridden)</span>
            )}
            {network && (
              <>
                {' | '}
                <span className="font-mono" title="CVSS vector">{stripCvssPrefix(finding.cvssVectorOverride ?? finding.vulnerability.cvssVector) || '-'}</span>
              </>
            )}
            {finding.vulnerability.cveId && <span className="text-cyan-400 ml-2">{finding.vulnerability.cveId}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* PoC Indicator (#5) */}
          <span
            title={pocIndicatorText[finding.pocReadiness]}
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
                  <p className="text-gray-500 text-xs">Status</p>
                  <p className="text-white">{finding.reportStatus}</p>
                </div>
              </div>
              {network && finding.vulnerability.cveId && (
                <div>
                  <p className="text-gray-500 text-xs">CVE ID(s)</p>
                  <p className="text-cyan-400 text-sm mt-1 break-words">{finding.vulnerability.cveId}</p>
                </div>
              )}
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
                          {stepImages(step).length > 0 && (
                            <p className="text-xs text-cyan-400 mt-1">
                              {stepImages(step).length === 1 ? 'Screenshot' : `Screenshots (${stepImages(step).length})`}: {stepImages(step).map(pocFileLabel).join(', ')}
                            </p>
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
  const [searchCategory, setSearchCategory] = useState<'BOTH' | 'APPLICATION_API' | 'NETWORK'>('BOTH');
  const [searchResults, setSearchResults] = useState<Vulnerability[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedVuln, setSelectedVuln] = useState<Vulnerability | null>(finding?.vulnerability || null);
  // Batch-add: pick several vulnerabilities at once, each created as a bare
  // finding (no CVSS override / POC yet) — tester fills those in later via
  // the existing Edit Finding flow, same as any other incomplete finding.
  const [batchVulns, setBatchVulns] = useState<Vulnerability[]>([]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
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
  // "Add Manually": a vulnerability that is not in the Vulnerability DB, created for this project only.
  const [showManual, setShowManual] = useState(false);
  // "Import Project Findings" (.csv / .xlsx): project-only findings, never added to the Vulnerability DB.
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const handleImportSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      alert('Choose a .csv or .xlsx file.');
      return;
    }
    if (file.size > IMPORT_MAX_BYTES) {
      alert('This file is larger than 100 MB, the upload limit.');
      return;
    }
    setImportFile(file);
  };

  const uploadStepImages = async (index: number, files: File[]) => {
    setUploadingStep(index);
    try {
      let list = stepImages(pocSteps[index]);
      for (const file of files) {
        if (list.length >= MAX_POC_IMAGES) {
          alert(`A step can have at most ${MAX_POC_IMAGES} PoC images.`);
          break;
        }
        const data = new FormData();
        data.append('file', file);
        const res = await api.post('/findings/upload-poc-image', data, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        list = [...list, res.data.path];
        setPocSteps((prev) => prev.map((s, i) => (i === index ? withStepImages(s, list) : s)));
      }
    } catch (error: any) {
      alert(error.response?.data?.message || 'Image upload failed');
    } finally {
      setUploadingStep(null);
    }
  };

  const removeStepImage = (index: number, imageIndex: number) =>
    setPocSteps((prev) => prev.map((s, i) => (i === index ? withStepImages(s, stepImages(s).filter((_, j) => j !== imageIndex)) : s)));

  const moveStepImage = (index: number, imageIndex: number, delta: -1 | 1) =>
    setPocSteps((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        const list = stepImages(s);
        const to = imageIndex + delta;
        if (to < 0 || to >= list.length) return s;
        [list[imageIndex], list[to]] = [list[to], list[imageIndex]];
        return withStepImages(s, list);
      }),
    );

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
        const params = new URLSearchParams({ search: searchQuery });
        if (searchCategory !== 'BOTH') params.set('category', searchCategory);
        const response = await api.get(`/vulnerabilities?${params.toString()}`);
        setSearchResults(response.data);
        setShowDropdown(true);
      } catch (error) {
        console.error('Search failed:', error);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchCategory]);

  const selectVulnerability = (vuln: Vulnerability) => {
    setSelectedVuln(vuln);
    setSearchQuery(vuln.name);
    setShowDropdown(false);
  };

  const goToConfigure = () => {
    if (!selectedVuln) return;
    setStep('configure');
  };

  const toggleBatchVuln = (vuln: Vulnerability) => {
    setBatchVulns((prev) =>
      prev.some((v) => v.id === vuln.id) ? prev.filter((v) => v.id !== vuln.id) : [...prev, vuln]
    );
  };

  const handleBatchAdd = async () => {
    if (batchVulns.length === 0) return;
    setBatchSubmitting(true);
    try {
      for (const vuln of batchVulns) {
        await api.post('/findings', {
          projectId,
          vulnId: vuln.id,
          testerNotes: '',
          affectedInstances: [],
          reportStatus: 'Open',
        });
      }
      onSaved();
    } catch (error: any) {
      alert(error.response?.data?.message || 'Failed to add findings');
    } finally {
      setBatchSubmitting(false);
    }
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
              imagePaths: stepImages(step),
            });
          } else {
            await api.post(`/findings/${finding.id}/poc-steps`, {
              stepNo: step.stepNo,
              description: step.description,
              imagePaths: stepImages(step),
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
            imagePaths: stepImages(step),
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

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-5xl min-h-[600px] max-h-[90vh] overflow-y-auto"
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
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm text-gray-300">Search Vulnerability Database *</label>
                    <div className="flex items-center gap-1 text-xs">
                      {(['BOTH', 'APPLICATION_API', 'NETWORK'] as const).map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setSearchCategory(c)}
                          className={`px-2 py-1 rounded-md transition-all ${
                            searchCategory === c
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-gray-800/50 text-gray-400 border border-gray-700 hover:text-white'
                          }`}
                        >
                          {c === 'BOTH' ? 'Both' : c === 'APPLICATION_API' ? 'Application/API' : 'Network'}
                        </button>
                      ))}
                    </div>
                  </div>
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
                    <div className="absolute z-20 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-96 overflow-y-auto">
                      {searchResults.map((vuln) => {
                        const inBatch = batchVulns.some((v) => v.id === vuln.id);
                        return (
                          <div
                            key={vuln.id}
                            className="flex items-center gap-1 px-2 hover:bg-gray-700 transition-colors border-b border-gray-700/50 last:border-0"
                          >
                            <button
                              type="button"
                              onClick={() => selectVulnerability(vuln)}
                              className="flex-1 min-w-0 text-left py-2"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-white">{vuln.name}</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="px-1.5 py-0.5 rounded text-xs border border-gray-600 text-gray-400">
                                    {vuln.category === 'NETWORK' ? 'Network' : 'App/API'}
                                  </span>
                                  <span className={`px-1.5 py-0.5 rounded text-xs ${severityColors[vuln.severity] || severityColors.Info}`}>
                                    {vuln.severity}
                                  </span>
                                </div>
                              </div>
                              <p className="text-xs text-gray-500 truncate">CVSS: {vuln.cvssScore ?? '-'} {vuln.cveId}</p>
                            </button>
                            {!finding && (
                              <button
                                type="button"
                                title={inBatch ? 'Remove from batch' : 'Add to batch'}
                                onClick={() => toggleBatchVuln(vuln)}
                                className={`shrink-0 p-1.5 rounded-lg transition-colors ${
                                  inBatch ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700/50 text-gray-400 hover:text-white'
                                }`}
                              >
                                {inBatch ? <CheckCircle className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Vulnerabilities queued for batch-add — each becomes a bare
                    finding on submit, filled in individually later via Edit */}
                {batchVulns.length > 0 && (
                  <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700 space-y-2">
                    <p className="text-xs text-gray-400">Selected for batch add ({batchVulns.length})</p>
                    <div className="flex flex-wrap gap-1.5">
                      {batchVulns.map((vuln) => (
                        <span
                          key={vuln.id}
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400"
                        >
                          {vuln.name}
                          <button type="button" onClick={() => toggleBatchVuln(vuln)} className="hover:text-white">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Preview of the selected canonical vulnerability, before it
                    becomes a project-specific finding */}
                {batchVulns.length === 0 && selectedVuln && (
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

                <div className="flex items-center justify-between gap-3 pt-2">
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setShowManual(true)}
                      title="Create a finding for a vulnerability that is not in the Vulnerability Database"
                      className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm"
                    >
                      Add Manually
                    </button>
                    <input ref={importInputRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={handleImportSelected} />
                    <button
                      type="button"
                      onClick={() => importInputRef.current?.click()}
                      title="Import findings for this project from a .csv or .xlsx file (project only; not added to the Vulnerability Database)"
                      className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm"
                    >
                      Import Project Findings
                    </button>
                  </div>
                  <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
                  >
                    Cancel
                  </button>
                  {batchVulns.length > 0 ? (
                    <button
                      type="button"
                      onClick={handleBatchAdd}
                      disabled={batchSubmitting}
                      className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50"
                    >
                      {batchSubmitting ? 'Adding...' : `Add ${batchVulns.length} Finding${batchVulns.length > 1 ? 's' : ''}`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={goToConfigure}
                      disabled={!selectedVuln}
                      className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50"
                    >
                      Continue
                    </button>
                  )}
                  </div>
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
              <p className="text-sm text-white font-medium">
                {finding.vulnerability.name}
                {finding.classification && <span className="ml-2 px-2 py-0.5 rounded-full text-xs border bg-cyan-500/10 text-cyan-400 border-cyan-500/20">{finding.classification}</span>}
              </p>
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
                  value={stripCvssPrefix(form.cvssVectorOverride)}
                  onChange={(e) => setForm({ ...form, cvssVectorOverride: e.target.value })}
                  placeholder={stripCvssPrefix(selectedVuln?.cvssVector) || 'Default from DB'}
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
              <label className="block text-xs text-gray-400 mb-1">Status</label>
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

          {/* Scan-imported (VA) findings take their evidence from the Nessus plugin output; steps/PoC are for PT findings. */}
          {finding?.findingType !== 'VA' && (
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
                          {stepImages(step).length > 0 ? 'Add Screenshots' : 'Upload Screenshots'}
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            disabled={uploadingStep !== null || stepImages(step).length >= MAX_POC_IMAGES}
                            onChange={(e) => {
                              const files = Array.from(e.target.files ?? []);
                              if (files.length > 0) uploadStepImages(index, files);
                              e.target.value = '';
                            }}
                          />
                        </label>
                        {stepImages(step).length > 0 && (
                          <span className="text-xs text-cyan-400">{stepImages(step).length} screenshot{stepImages(step).length === 1 ? '' : 's'} attached</span>
                        )}
                      </div>
                      {stepImages(step).length > 0 && (
                        <ol className="space-y-1" aria-label={`Screenshots of step ${step.stepNo}, in report order`}>
                          {stepImages(step).map((path, imageIndex, list) => (
                            <li key={path} className="flex items-center gap-2 text-xs text-gray-300 bg-gray-900/50 rounded px-2 py-1">
                              <span className="w-5 text-gray-500 tabular-nums">{imageIndex + 1}.</span>
                              <span className="flex-1 truncate" title={pocFileLabel(path)}>{pocFileLabel(path)}</span>
                              <button type="button" onClick={() => moveStepImage(index, imageIndex, -1)} disabled={imageIndex === 0} aria-label="Move up" className="px-1 text-gray-400 hover:text-white disabled:opacity-30">↑</button>
                              <button type="button" onClick={() => moveStepImage(index, imageIndex, 1)} disabled={imageIndex === list.length - 1} aria-label="Move down" className="px-1 text-gray-400 hover:text-white disabled:opacity-30">↓</button>
                              <button type="button" onClick={() => removeStepImage(index, imageIndex)} aria-label="Remove screenshot" className="px-1 text-gray-400 hover:text-red-400">✕</button>
                            </li>
                          ))}
                        </ol>
                      )}
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
      {importFile && <ProjectFindingsImportDialog projectId={projectId} file={importFile} onClose={() => setImportFile(null)} onImported={onSaved} />}
      {showManual && <ManualFindingModal projectId={projectId} onClose={() => setShowManual(false)} onSaved={onSaved} />}
    </div>,
    document.body
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
      <p className="text-xs text-gray-500 font-mono break-all">{stripCvssPrefix(vector)}</p>
    </div>
  );
}

const MANUAL_EMPTY = {
  name: '', severity: 'Medium', cvssScore: '', cvssVector: '', description: '', impact: '', remediation: '',
  references: '', cveId: '', cweId: '', affectedInstances: '', testerNotes: '',
};

/**
 * Add Manually: a vulnerability that is not in the Vulnerability Database. It is always created in this project.
 * With "Sync Vuln DB" on (the default) a separate request is also sent through the existing approval flow; the
 * project finding is saved either way and is not affected by the decision.
 */
function ManualFindingModal({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => void }) {
  const showToast = useToast();
  const [form, setForm] = useState(MANUAL_EMPTY);
  const [syncVulnDb, setSyncVulnDb] = useState(true);
  const [showCvssCalc, setShowCvssCalc] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const set = (key: keyof typeof MANUAL_EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const input = 'w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm text-white';
  const label = 'block text-xs text-gray-400 mb-1';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrors([]);
    try {
      const res = await api.post('/findings/manual', {
        projectId,
        name: form.name,
        severity: form.severity,
        cvssScore: form.cvssScore === '' ? undefined : form.cvssScore,
        cvssVector: form.cvssVector || undefined,
        description: form.description,
        impact: form.impact,
        remediation: form.remediation,
        references: form.references,
        cveId: form.cveId || undefined,
        cweId: form.cweId || undefined,
        affectedInstances: form.affectedInstances.split('\n').filter((x) => x.trim()),
        testerNotes: form.testerNotes,
        syncVulnDb,
      });
      const sync = res.data.sync?.status;
      const note: Record<string, string> = {
        requested: ' A Vulnerability Database request was sent for approval.',
        already_pending: ' The Vulnerability Database already has a pending request for it.',
        already_exists: ' It is already in the Vulnerability Database.',
        not_permitted: ' Your role cannot send Vulnerability Database requests, so none was sent.',
        failed: ' The Vulnerability Database request could not be created; the finding is saved in this project.',
      };
      showToast(`Finding added to this project.${note[sync] ?? ''}`, sync === 'failed' ? 'error' : 'success');
      onSaved();
    } catch (error: any) {
      const msg = error.response?.data?.message;
      setErrors(Array.isArray(msg) ? msg : [msg || 'Failed to add the finding']);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="manual-finding-title" className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-700 sticky top-0 bg-gray-900 z-10">
          <h2 id="manual-finding-title" className="text-lg font-semibold text-white">Add Finding Manually</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:bg-gray-800 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="mf-name" className={label}>Vulnerability Name *</label>
            <input id="mf-name" required maxLength={300} value={form.name} onChange={set('name')} className={input} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="mf-severity" className={label}>Severity *</label>
              <select id="mf-severity" value={form.severity} onChange={set('severity')} className={input}>
                {Object.keys(severityColors).map((sev) => <option key={sev} value={sev}>{sev}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="mf-score" className={label}>CVSS Score</label>
              <input id="mf-score" type="number" step="0.1" min="0" max="10" value={form.cvssScore} onChange={set('cvssScore')} className={input} />
            </div>
            <div>
              <label htmlFor="mf-vector" className={label}>CVSS Vector</label>
              <input id="mf-vector" value={form.cvssVector} onChange={set('cvssVector')} placeholder="CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N" className={`${input} font-mono text-xs`} />
            </div>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setShowCvssCalc(!showCvssCalc)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-600/20 text-cyan-400 text-xs hover:bg-cyan-600/30 transition-all"
            >
              <ShieldAlert className="w-3 h-3" />
              {showCvssCalc ? 'Hide Calculator' : 'CVSS Calculator'}
            </button>
            {showCvssCalc && (
              <div className="mt-2">
                <CvssCalculator
                  initialVector={form.cvssVector}
                  onApply={(score, vector) => setForm((f) => ({ ...f, cvssScore: score.toString(), cvssVector: vector, severity: cvssSeverity(score) in severityColors ? cvssSeverity(score) : f.severity }))}
                />
              </div>
            )}
          </div>

          {([
            ['description', 'Description *', 'mf-description'],
            ['impact', 'Impact *', 'mf-impact'],
            ['remediation', 'Remediation *', 'mf-remediation'],
            ['references', 'Reference *', 'mf-references'],
          ] as const).map(([key, text, id]) => (
            <div key={key}>
              <label htmlFor={id} className={label}>{text}</label>
              <textarea id={id} required rows={key === 'references' ? 2 : 3} value={form[key]} onChange={set(key)} className={input} />
            </div>
          ))}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="mf-cve" className={label}>CVE ID (optional)</label>
              <input id="mf-cve" value={form.cveId} onChange={set('cveId')} placeholder="CVE-2024-12345" className={input} />
            </div>
            <div>
              <label htmlFor="mf-cwe" className={label}>CWE ID (optional)</label>
              <input id="mf-cwe" value={form.cweId} onChange={set('cweId')} placeholder="CWE-79" className={input} />
            </div>
          </div>

          <div>
            <label htmlFor="mf-affected" className={label}>Affected URLs / hosts (optional, one per line)</label>
            <textarea id="mf-affected" rows={2} value={form.affectedInstances} onChange={set('affectedInstances')} className={input} />
          </div>
          <div>
            <label htmlFor="mf-notes" className={label}>Tester notes (optional)</label>
            <textarea id="mf-notes" rows={2} value={form.testerNotes} onChange={set('testerNotes')} className={input} />
          </div>

          <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700">
            <div className="flex items-start gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={syncVulnDb}
                aria-labelledby="mf-sync-label"
                onClick={() => setSyncVulnDb((v) => !v)}
                className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-300 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${syncVulnDb ? 'bg-emerald-500' : 'bg-gray-600'}`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300 ease-in-out ${syncVulnDb ? 'translate-x-5' : 'translate-x-0'}`}
                />
              </button>
              <div>
                <span id="mf-sync-label" className="block text-sm text-white font-medium">Sync Vuln DB</span>
                <span className="block text-xs text-gray-400 mt-0.5">
                  {syncVulnDb
                    ? 'On: the finding is added to this project now, and a separate request to add the vulnerability to the Vulnerability Database is sent for approval. The finding stays usable whatever the decision.'
                    : 'Off: the finding exists only in this project. Nothing is sent to the Vulnerability Database.'}
                </span>
              </div>
            </div>
          </div>

          {errors.length > 0 && (
            <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-300 space-y-1">
              {errors.map((m, i) => <p key={i}>{m}</p>)}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm">Cancel</button>
            <button type="submit" disabled={submitting} className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50 flex items-center gap-2">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {submitting ? 'Saving...' : 'Add Finding'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function GeneratedReportsSection({ projectId, refreshKey, canDelete }: { projectId: string; refreshKey: any; canDelete: boolean }) {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const confirmDialog = useConfirm();
  const showToast = useToast();

  const load = () => {
    api.get(`/reports/history/${projectId}`)
      .then((res) => setReports(res.data))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [projectId, refreshKey]);

  const handleDelete = async (report: any) => {
    const name = report.fileName || report.template?.name || 'Report';
    const ok = await confirmDialog({
      title: 'Delete report?',
      message: `Report "${name}" is being deleted`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/reports/${report.id}`);
      load();
    } catch (error: any) {
      showToast(error.response?.data?.message || 'Failed to delete report', 'error');
    }
  };

  if (loading || reports.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-white">Generated Reports ({reports.length})</h2>
      <div className="glass-card rounded-xl divide-y divide-gray-800">
        {reports.map((r) => (
          <div key={r.id} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="w-4 h-4 text-blue-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm text-white truncate">{r.fileName || r.template?.name || 'Report'}</p>
                <p className="text-xs text-gray-500">
                  Generated {formatDateTime(r.createdAt)} by {r.generatedBy?.fullName || r.generatedBy?.username || 'unknown'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {r.docxUrl ? (
                <a
                  href={r.docxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/20 text-xs font-medium transition-all"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </a>
              ) : (
                <span className="text-xs text-gray-600">Unavailable</span>
              )}
              {canDelete && reports.length > 1 && (
                <button
                  onClick={() => handleDelete(r)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  title="Delete report"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
