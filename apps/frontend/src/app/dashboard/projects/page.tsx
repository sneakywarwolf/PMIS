'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderKanban, Plus, Search, FileText, Edit, AlertTriangle, X, Loader2, CheckCircle, Eye, LayoutGrid, Table2, Trash2 } from 'lucide-react';
import { toDateInputValue, formatDate } from '@/lib/datetime';
import { api, useAuth } from '@/contexts/auth-context';
import { NetworkLimitationCaution } from '@/components/network-limitation-caution';
import { triggerDownload } from '@/lib/download';
import { useToast } from '@/components/toast-provider';
import { useConfirm } from '@/components/confirm-provider';

const statusColors: Record<string, string> = {
  NOT_STARTED: 'bg-gray-700 text-gray-300',
  IN_PROGRESS: 'bg-blue-900/50 text-blue-400',
  AWAITING_REVIEW: 'bg-yellow-900/50 text-yellow-400',
  COMPLETED: 'bg-emerald-900/50 text-emerald-400',
};

const statusLabels: Record<string, string> = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  AWAITING_REVIEW: 'Awaiting Review',
  COMPLETED: 'Completed',
};

interface Project {
  id: string;
  name: string;
  clientName: string;
  status: string;
  scope?: string;
  startDate: string;
  endDate?: string;
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
  complianceType?: string;
  complianceStatus?: string | null;
  category?: string;
  subType?: string;
  template?: { id: string; name: string } | null;
  tester?: { id: string; username: string; email: string; fullName?: string | null };
  tl?: { id: string; username: string; email: string; fullName?: string | null };
  _count?: { findings: number };
  startDateChangedAt?: string | null;
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={null}>
      <ProjectsPageContent />
    </Suspense>
  );
}

function ProjectsPageContent() {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '');
  const [tlFilter, setTlFilter] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [generatingReport, setGeneratingReport] = useState<string | null>(null);
  const [reportResult, setReportResult] = useState<any>(null);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await api.get('/projects');
      setProjects(response.data);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateReport = async (projectId: string) => {
    setGeneratingReport(projectId);
    try {
      // Generation runs in a background queue so it doesn't block other
      // users generating reports at the same time — poll until it's done.
      const queued = await api.post('/reports/generate', { projectId });
      const reportId = queued.data.reportId;

      let status = queued.data.status;
      while (status === 'PENDING') {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const poll = await api.get(`/reports/generate/${reportId}/status`);
        status = poll.data.status;
        if (status === 'COMPLETED') {
          setReportResult(poll.data);
          if (poll.data.docxUrl) triggerDownload(poll.data.docxUrl, poll.data.fileName);
          toast('Report generated successfully');
        } else if (status === 'FAILED') {
          toast(poll.data.error || 'Report generation failed', 'error');
        }
      }
    } catch (error: any) {
      toast(error.response?.data?.message || 'Report generation failed', 'error');
    } finally {
      setGeneratingReport(null);
    }
  };

  const handleGenerateIssueLog = async (projectId: string) => {
    try {
      const { data } = await api.get(`/reports/issue-log/${projectId}`);
      const url = window.URL.createObjectURL(new Blob([data.csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = data.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      toast(error.response?.data?.message || 'Failed to generate issue log', 'error');
    }
  };

  const handleDeleteProject = async (project: Project) => {
    const ok = await confirmDialog({
      title: 'Permanently delete project?',
      message: `"${project.name}" and all its findings, reports, PoCs/attachments, and issue logs will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Delete Permanently',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/projects/${project.id}`);
      toast('Project permanently deleted');
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
    } catch (error: any) {
      toast(error.response?.data?.message || 'Failed to delete project', 'error');
    }
  };

  const isAdminOrAvp = user?.role === 'ADMIN' || user?.role === 'AVP';
  const tlOptions = isAdminOrAvp
    ? Array.from(
        new Map(
          projects
            .filter((p) => p.tl)
            .map((p) => [p.tl!.id, { id: p.tl!.id, label: p.tl!.fullName || p.tl!.username }]),
        ).values(),
      ).sort((a, b) => a.label.localeCompare(b.label))
    : [];

  const filteredProjects = projects.filter(p => {
    const matchesSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.clientName.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || p.status === statusFilter;
    const matchesTl = !tlFilter || p.tl?.id === tlFilter;
    return matchesSearch && matchesStatus && matchesTl;
  });

  if (loading) {
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
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-gray-400 text-sm mt-1">Manage your VAPT assessments</p>
        </div>
        <Link
          href="/dashboard/projects/new"
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-all"
        >
          <Plus className="w-4 h-4" />
          New Project
        </Link>
      </div>

      {/* Filters + Toggle */}
      <div className="flex gap-4 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 transition-all"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 transition-all"
        >
          <option value="">All Status</option>
          <option value="NOT_STARTED">Not Started</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="AWAITING_REVIEW">Awaiting Review</option>
          <option value="COMPLETED">Completed</option>
        </select>
        {isAdminOrAvp && (
          <select
            value={tlFilter}
            onChange={(e) => setTlFilter(e.target.value)}
            className="px-4 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 transition-all"
          >
            <option value="">All TLs</option>
            {tlOptions.map((tl) => (
              <option key={tl.id} value={tl.id}>{tl.label}</option>
            ))}
          </select>
        )}
        <div className="flex items-center bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 transition-all ${viewMode === 'grid' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'}`}
            title="Grid view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`p-2 transition-all ${viewMode === 'table' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'}`}
            title="Table view"
          >
            <Table2 className="w-4 h-4" />
          </button>
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

      {/* Grid View */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((project, index) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => router.push(`/dashboard/projects/${project.id}`)}
              className="glass-card rounded-xl p-5 hover:border-emerald-500/30 transition-all cursor-pointer"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <FolderKanban className="w-5 h-5 text-emerald-400" />
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[project.status]}`}>
                  {statusLabels[project.status]}
                </span>
              </div>
              
              <h3 className="font-semibold text-white mb-1">{project.name}</h3>
              <p className="text-sm text-gray-400 mb-3">{project.clientName}</p>
              
              <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                <span>Tester: {project.tester?.fullName || project.tester?.username}</span>
                <span>{project._count?.findings || 0} findings</span>
              </div>

              <div className="space-y-2 mb-3" onClick={(e) => e.stopPropagation()}>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setEditProject(project)}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gray-700/50 hover:bg-gray-700 text-gray-300 text-xs font-medium transition-all"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <Link
                    href={`/dashboard/projects/${project.id}`}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-medium transition-all"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    View
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleGenerateIssueLog(project.id)}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs font-medium transition-all"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Issue Log
                  </button>
                  <button
                    onClick={() => handleGenerateReport(project.id)}
                    disabled={generatingReport === project.id || ((project._count?.findings ?? 0) === 0 && project.complianceStatus !== 'Compliant')}
                    className="flex items-center justify-center gap-2 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-medium transition-all disabled:opacity-50"
                  >
                    {generatingReport === project.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileText className="w-3.5 h-3.5" />
                    )}
                    {generatingReport === project.id ? 'Generating...' : 'Report'}
                  </button>
                </div>
                {user?.role === 'ADMIN' && (
                  <button
                    onClick={() => handleDeleteProject(project)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                )}
              </div>

              <div className="pt-3 border-t border-gray-700/50 flex items-center justify-between text-xs">
                <span className="text-gray-400 flex items-center gap-1">
                  {formatDate(project.startDate)}
                  {user?.role !== 'TESTER' && project.startDateChangedAt && (
                    <span title="Start date changed after project creation"><AlertTriangle className="w-3.5 h-3.5 text-amber-400" /></span>
                  )}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && (
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-4 py-3 text-sm font-medium text-gray-400">Name</th>
                  <th className="px-4 py-3 text-sm font-medium text-gray-400">Client</th>
                  <th className="px-4 py-3 text-sm font-medium text-gray-400">Status</th>
                  <th className="px-4 py-3 text-sm font-medium text-gray-400">Tester</th>
                  <th className="px-4 py-3 text-sm font-medium text-gray-400">Findings</th>
                  <th className="px-4 py-3 text-sm font-medium text-gray-400">Start Date</th>
                  <th className="px-4 py-3 text-sm font-medium text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.map((project, i) => (
                  <motion.tr
                    key={project.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    onClick={() => router.push(`/dashboard/projects/${project.id}`)}
                    className="border-b border-gray-700/50 hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-white">{project.name}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">{project.clientName}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[project.status]}`}>
                        {statusLabels[project.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">{project.tester?.fullName || project.tester?.username}</td>
                    <td className="px-4 py-3 text-sm text-white">{project._count?.findings || 0}</td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      <span className="flex items-center gap-1">
                        {formatDate(project.startDate)}
                        {user?.role !== 'TESTER' && project.startDateChangedAt && (
                          <span title="Start date changed after project creation"><AlertTriangle className="w-3.5 h-3.5 text-amber-400" /></span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setEditProject(project)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
                          title="Edit"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <Link
                          href={`/dashboard/projects/${project.id}`}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 transition-all"
                          title="View"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Link>
                        <button
                          onClick={() => handleGenerateIssueLog(project.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 transition-all"
                          title="Issue Log"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleGenerateReport(project.id)}
                          disabled={generatingReport === project.id || ((project._count?.findings ?? 0) === 0 && project.complianceStatus !== 'Compliant')}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all disabled:opacity-50"
                          title={(project._count?.findings ?? 0) > 0 || project.complianceStatus === 'Compliant' ? 'Report' : 'Add findings, or set the project status to Compliant, before generating a report.'}
                        >
                          {generatingReport === project.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <FileText className="w-3.5 h-3.5" />
                          )}
                        </button>
                        {user?.role === 'ADMIN' && (
                          <button
                            onClick={() => handleDeleteProject(project)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                            title="Delete Permanently"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredProjects.length === 0 && (
            <div className="text-center py-12">
              <FolderKanban className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">No projects found</p>
            </div>
          )}
        </div>
      )}

      {viewMode === 'grid' && filteredProjects.length === 0 && (
        <div className="text-center py-12">
          <FolderKanban className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No projects found</p>
        </div>
      )}

      {/* Edit Project Modal */}
      {editProject && (
        <EditProjectModal
          project={editProject}
          onClose={() => setEditProject(null)}
          onSaved={() => { fetchProjects(); setEditProject(null); }}
        />
      )}
    </div>
  );
}

function EditProjectModal({ project, onClose, onSaved }: { project: Project; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const canEditStartDate = user?.id === project.tester?.id;
  const [submitting, setSubmitting] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: project.name,
    clientName: project.clientName,
    scope: project.scope || '',
    startDate: toDateInputValue(project.startDate),
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
    complianceType: project.complianceType || 'VAPT',
    templateId: project.template?.id || '',
  });

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  // Fetch templates when complianceType changes
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const res = await api.get(`/reports/templates?category=${form.complianceType}&reportFormat=WORD`);
        setTemplates(res.data);
      } catch (error) {
        console.error('Failed to fetch templates:', error);
      }
    };
    fetchTemplates();
  }, [form.complianceType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload: any = { ...form };
      if (!canEditStartDate) delete payload.startDate;
      if (!payload.templateId) payload.templateId = undefined;
      await api.put(`/projects/${project.id}`, payload);
      onSaved();
      toast('Project updated');
    } catch (error: any) {
      toast(error.response?.data?.message || 'Failed to update project', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full min-w-0 px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm text-white';
  const labelCls = 'block text-xs text-gray-400 mb-1';

  return (
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
            {canEditStartDate && (
              <div>
                <label className={labelCls}>Start Date</label>
                <input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} className={inputCls} />
              </div>
            )}
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
            <textarea rows={8} value={form.applicationNature} onChange={(e) => set('applicationNature', e.target.value)} className={`${inputCls} min-h-[10rem] max-h-[60vh] resize-y`} />
          </div>
          <div>
            <label className={labelCls}>Testing Limitation</label>
            <textarea rows={8} value={form.testingLimitation} onChange={(e) => set('testingLimitation', e.target.value)} className={`${inputCls} min-h-[10rem] max-h-[60vh] resize-y`} placeholder="Leave empty for N/A" />
            {project?.subType === 'NETWORK' && <NetworkLimitationCaution />}
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
