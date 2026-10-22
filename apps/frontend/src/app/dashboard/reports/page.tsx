'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, Upload, Download, Eye, ChevronRight, ChevronLeft,
  Shield, Server, Smartphone, Monitor, CheckCircle, Loader2,
  AlertTriangle, XCircle, Check, ArrowLeftRight, CheckCircle2, Trash2,
} from 'lucide-react';
import { api, useAuth } from '@/contexts/auth-context';
import { triggerDownload } from '@/lib/download';
import { useToast } from '@/components/toast-provider';
import { useConfirm } from '@/components/confirm-provider';
import { toDateInputValue } from '@/lib/datetime';

const subTypeIcons: any = {
  WEB: Monitor,
  API: Server,
  MOBILE: Smartphone,
  THICK_CLIENT: Monitor,
  NETWORK: Server,
  APPLICATION: FileText,
};

const subTypeLabels: any = {
  WEB: 'Web Application',
  API: 'API',
  MOBILE: 'Mobile Application',
  THICK_CLIENT: 'Thick Client',
  NETWORK: 'Network',
  APPLICATION: 'Application',
};

// Category display name: the stored value, except Cert-In which reads better than CERT_IN.
const categoryLabel = (c: string) => (c === 'CERT_IN' ? 'Cert-In' : c);

// Activity Types a template can be uploaded for, per category (the same two lists the upload form always offered).
const activityTypesFor = (category: string): string[] =>
  category === 'CERT_IN' ? ['APPLICATION', 'NETWORK'] : ['WEB', 'API', 'MOBILE', 'THICK_CLIENT', 'NETWORK', 'APPLICATION'];

// Every Activity Type a template serves: its primary one plus any extras.
const templateSubTypes = (t: any): string[] => [t.subType, ...(t.extraSubTypes ?? [])];

export default function ReportsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('generate');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Reports & Templates</h1>
        <p className="text-gray-400 text-sm mt-1">Generate and manage assessment reports</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('generate')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'generate'
              ? 'bg-emerald-600 text-white'
              : 'bg-gray-800/50 text-gray-400 hover:text-white'
          }`}
        >
          Generate Report
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'templates'
              ? 'bg-emerald-600 text-white'
              : 'bg-gray-800/50 text-gray-400 hover:text-white'
          }`}
        >
          Browse Templates
        </button>
        {user?.role === 'ADMIN' && (
          <button
            onClick={() => setActiveTab('upload')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'upload'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800/50 text-gray-400 hover:text-white'
            }`}
          >
            Upload Template
          </button>
        )}
        {user?.role === 'ADMIN' && (
          <button
            onClick={() => setActiveTab('mapping')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'mapping'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800/50 text-gray-400 hover:text-white'
            }`}
          >
            Template Mapping
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'generate' && (
          <motion.div key="generate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Suspense fallback={
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
              </div>
            }>
              <ReportGenerator />
            </Suspense>
          </motion.div>
        )}
        {activeTab === 'templates' && (
          <motion.div key="templates" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <TemplateBrowser isAdmin={user?.role === 'ADMIN'} />
          </motion.div>
        )}
        {activeTab === 'upload' && (
          <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <TemplateUploader />
          </motion.div>
        )}
        {activeTab === 'mapping' && (
          <motion.div key="mapping" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <TemplateMapping />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report generation: select project → preflight check → generate (DOCX)
// ---------------------------------------------------------------------------

function ReportGenerator() {
  const toast = useToast();
  const searchParams = useSearchParams();
  const preselectedProjectId = searchParams.get('project');

  const [step, setStep] = useState(1);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [preflight, setPreflight] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    if (preselectedProjectId && projects.length > 0 && !selectedProject) {
      const project = projects.find(p => p.id === preselectedProjectId);
      if (project) handleSelectProject(project);
    }
  }, [preselectedProjectId, projects]);

  const fetchProjects = async () => {
    try {
      const response = await api.get('/projects');
      setProjects(response.data);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    }
  };

  const handleSelectProject = async (project: any) => {
    setSelectedProject(project);
    setLoading(true);
    setStep(2);
    try {
      const response = await api.get(`/reports/preflight/${project.id}`);
      setPreflight(response.data);
    } catch (error: any) {
      toast(error.response?.data?.message || 'Preflight check failed', 'error');
      setStep(1);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedProject) return;
    setGenerating(true);
    try {
      // Generation runs in a background queue (so it doesn't block other
      // users generating reports at the same time) — this just enqueues
      // the job; we poll for completion below.
      const queued = await api.post('/reports/generate', { projectId: selectedProject.id });
      const reportId = queued.data.reportId;

      let status = queued.data.status;
      while (status === 'PENDING') {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const poll = await api.get(`/reports/generate/${reportId}/status`);
        status = poll.data.status;
        if (status === 'COMPLETED') {
          setResult({ ...poll.data, findingsCount: preflight?.approvedFindings ?? 0 });
          if (poll.data.docxUrl) triggerDownload(poll.data.docxUrl, poll.data.fileName);
          setStep(3);
          toast('Report generated successfully');
        } else if (status === 'FAILED') {
          toast(poll.data.error || 'Report generation failed', 'error');
        }
      }
    } catch (error: any) {
      toast(error.response?.data?.message || 'Report generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step >= s ? 'bg-emerald-600 text-white' : 'bg-gray-700 text-gray-400'
            }`}>
              {step > s ? <CheckCircle className="w-4 h-4" /> : s}
            </div>
            {s < 3 && <div className={`w-12 h-0.5 ${step > s ? 'bg-emerald-600' : 'bg-gray-700'}`} />}
          </div>
        ))}
        <span className="ml-3 text-sm text-gray-400">
          {step === 1 ? 'Select Project' : step === 2 ? 'Preflight Check' : 'Done'}
        </span>
      </div>

      {/* Step 1: Select Project */}
      {step === 1 && (
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Select Project</h2>
          <p className="text-sm text-gray-400">
            The report is filled automatically from project details, team profiles, and approved findings.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => handleSelectProject(project)}
                className="text-left p-4 rounded-xl glass-card hover:border-emerald-500/30 transition-all"
              >
                <p className="font-medium text-white">{project.name}</p>
                <p className="text-sm text-gray-400">{project.clientName}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {project.category} • {subTypeLabels[project.subType] || project.subType} • {project._count?.findings || 0} findings
                </p>
              </button>
            ))}
          </div>
          {projects.length === 0 && (
            <p className="text-gray-500 text-sm py-8 text-center">No projects available</p>
          )}
        </motion.div>
      )}

      {/* Step 2: Preflight */}
      {step === 2 && (
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Preflight Check — {selectedProject?.name}</h2>
            <button onClick={() => setStep(1)} className="text-sm text-gray-400 hover:text-white flex items-center gap-1">
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
              <span className="ml-2 text-gray-400">Checking report data...</span>
            </div>
          ) : preflight && (
            <div className="glass-card rounded-xl p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div className="p-3 rounded-lg bg-gray-800/50">
                  <p className="text-gray-500 text-xs">Template</p>
                  <p className="text-white">{preflight.templateName || 'None'}</p>
                </div>
                <div className="p-3 rounded-lg bg-gray-800/50">
                  <p className="text-gray-500 text-xs">Approved Findings</p>
                  <p className="text-white">{preflight.approvedFindings}</p>
                </div>
                <div className="p-3 rounded-lg bg-gray-800/50">
                  <p className="text-gray-500 text-xs">Output File</p>
                  <p className="text-white text-xs break-all">{preflight.suggestedFileName}</p>
                </div>
              </div>

              {preflight.missing.length > 0 ? (
                <div className={`rounded-lg p-4 border ${preflight.pocGateBlocked ? 'bg-red-500/10 border-red-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
                  <p className={`text-sm font-medium flex items-center gap-2 mb-2 ${preflight.pocGateBlocked ? 'text-red-400' : 'text-amber-400'}`}>
                    <AlertTriangle className="w-4 h-4" />
                    {preflight.pocGateBlocked
                      ? 'Report Generation not allowed until Steps and PoC are added.'
                      : `${preflight.missing.length} item(s) missing — the report will contain blanks for these`}
                  </p>
                  <ul className="space-y-1">
                    {preflight.missing.map((m: any) => (
                      <li key={m.field} className="text-xs text-gray-300 flex items-center gap-2">
                        <XCircle className="w-3 h-3 text-amber-400 shrink-0" />
                        <span className="text-white">{m.label}</span>
                        <span className="text-gray-500">— fix in {m.source}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4">
                  <p className="text-sm text-emerald-400 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    All report data is complete
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
                <button
                  onClick={() => setStep(1)}
                  className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
                >
                  Back
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={generating || preflight.approvedFindings === 0 || preflight.pocGateBlocked}
                  className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  {generating ? 'Generating...' : 'Generate DOCX Report'}
                </button>
              </div>
              {preflight.approvedFindings === 0 && (
                <p className="text-xs text-amber-400 text-right">
                  At least one approved finding is required
                </p>
              )}
            </div>
          )}
        </motion.div>
      )}

      {/* Step 3: Result */}
      {step === 3 && result && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Report Generated!</h2>
            <p className="text-gray-400 text-sm mt-1">
              {result.findingsCount} findings included
            </p>
            <p className="text-gray-500 text-xs mt-1 font-mono break-all px-8">{result.fileName}</p>
          </div>

          <div className="glass-card rounded-xl p-6 space-y-4">
            <a
              href={result.docxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-all"
            >
              <Download className="w-4 h-4" />
              Download DOCX
            </a>
            <p className="text-xs text-gray-500 text-center">
              Open in Word to make final adjustments before delivery.
            </p>
          </div>

          <div className="flex justify-center">
            <button
              onClick={() => { setStep(1); setSelectedProject(null); setPreflight(null); setResult(null); }}
              className="text-sm text-gray-400 hover:text-white"
            >
              Generate Another Report
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template browser — admin sees drafts and can activate them
// ---------------------------------------------------------------------------

const CANONICAL_FIELD_NAMES = [
  'start_date', 'end_date', 'qa_reviewer_name', 'team_lead_name', 'tester_name',
  'app_version', 'version_ex', 'client_name_location', 'client_name', 'month_dd_yyyy',
  'tools_name', 'tools_used', 'details_scope', 'scope', 'staging_uat',
  'testing_environment', 'black_box', 'grey_box', 'login_role_types',
  'nature_or_purpose', 'testing_limitation', 'build_details',
];

function slugifyFieldName(raw: string) {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function TemplateBrowser({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [fields, setFields] = useState<any[]>([]);
  const [activating, setActivating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [addingField, setAddingField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldName, setNewFieldName] = useState('');
  const [savingField, setSavingField] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  useEffect(() => {
    fetchTemplates();
  }, []);

  // Categories come from the templates themselves, so a new category appears without touching this list.
  const categories = Array.from(new Set(templates.map((t) => t.category as string)));
  const visibleTemplates = categoryFilter === 'ALL' ? templates : templates.filter((t) => t.category === categoryFilter);

  const fetchTemplates = async () => {
    try {
      const response = await api.get(isAdmin ? '/reports/templates/all' : '/reports/templates');
      setTemplates(response.data);
    } catch (error) {
      console.error('Failed to fetch templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const viewFields = async (template: any) => {
    setSelectedTemplate(template);
    setAddingField(false);
    setEditingFieldId(null);
    try {
      const response = await api.get(`/reports/templates/${template.id}/fields`);
      setFields(response.data);
    } catch (error) {
      console.error('Failed to fetch fields:', error);
    }
  };

  const isDuplicateFieldName = (slug: string) => {
    if (!slug) return false;
    const collides = (other: string) => slug.includes(other) || other.includes(slug);
    return CANONICAL_FIELD_NAMES.some(collides) || fields.some((f) => collides(f.normalizedName));
  };

  const saveNewField = async () => {
    const slug = slugifyFieldName(newFieldName);
    if (!newFieldLabel.trim() || !slug || isDuplicateFieldName(slug)) return;
    setSavingField(true);
    try {
      const res = await api.post(`/reports/templates/${selectedTemplate.id}/fields`, {
        name: newFieldLabel.trim(),
        normalizedName: slug,
        category: 'OTHER',
      });
      setFields((prev) => [...prev, res.data]);
      setNewFieldLabel('');
      setNewFieldName('');
      setAddingField(false);
      toast('Field added');
    } catch (error: any) {
      toast(error.response?.data?.message || 'Failed to add field', 'error');
    } finally {
      setSavingField(false);
    }
  };

  const saveEditedLabel = async (fieldId: string) => {
    if (!editLabel.trim()) return;
    try {
      const res = await api.put(`/reports/templates/fields/${fieldId}`, { name: editLabel.trim() });
      setFields((prev) => prev.map((f) => (f.id === fieldId ? res.data : f)));
      setEditingFieldId(null);
      toast('Field updated');
    } catch (error: any) {
      toast(error.response?.data?.message || 'Failed to update field', 'error');
    }
  };

  const activate = async (template: any) => {
    if (!confirm(`Activate "${template.name}"? The current active ${template.category}/${template.subType} template will be permanently deleted (file, metadata, and mappings removed).`)) return;
    setActivating(template.id);
    try {
      await api.put(`/reports/templates/${template.id}/activate`);
      fetchTemplates();
      toast('Template activated');
    } catch (error: any) {
      toast(error.response?.data?.message || 'Activation failed', 'error');
    } finally {
      setActivating(null);
    }
  };

  const handleDelete = async (template: any) => {
    const ok = await confirmDialog({
      title: `Delete template "${template.name}"?`,
      message: 'This permanently removes the template file and its associated metadata/mapping. Previously generated reports are unaffected and remain downloadable.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setDeleting(template.id);
    try {
      await api.delete(`/reports/templates/${template.id}`);
      if (selectedTemplate?.id === template.id) setSelectedTemplate(null);
      await fetchTemplates();
      toast('Template deleted');
    } catch (error: any) {
      toast(error.response?.data?.message || 'Failed to delete template', 'error');
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter templates by category">
          {['ALL', ...categories].map((key) => {
            const count = key === 'ALL' ? templates.length : templates.filter((t) => t.category === key).length;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={categoryFilter === key}
                onClick={() => setCategoryFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                  categoryFilter === key
                    ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30'
                    : 'bg-gray-800/50 text-gray-400 border-gray-700 hover:text-white'
                }`}
              >
                {key === 'ALL' ? 'All Categories' : categoryLabel(key)} ({count})
              </button>
            );
          })}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {visibleTemplates.map((template) => {
          const Icon = subTypeIcons[template.subType] || FileText;
          return (
            <div
              key={template.id}
              className={`p-4 rounded-xl glass-card flex items-start gap-3 ${
                !template.isActive ? 'opacity-70 border-dashed' : ''
              }`}
            >
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-white">{template.name}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="px-2 py-0.5 rounded-full text-xs bg-blue-500/10 text-blue-400">{template.category}</span>
                  {templateSubTypes(template).map((st) => (
                    <span key={st} className="px-2 py-0.5 rounded-full text-xs bg-violet-500/10 text-violet-400">{subTypeLabels[st] || st}</span>
                  ))}
                  <span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/10 text-amber-400">{template.reportFormat === 'EXCEL' ? 'Excel Report' : 'Word Report'}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    template.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-600/30 text-gray-400'
                  }`}>
                    {template.isActive ? 'Active' : 'Draft / Inactive'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{template.fields?.length || 0} fields</p>
              </div>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => viewFields(template)}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all"
                >
                  <Eye className="w-4 h-4" />
                </button>
                {isAdmin && !template.isActive && (
                  <button
                    onClick={() => activate(template)}
                    disabled={activating === template.id}
                    className="p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-all disabled:opacity-50"
                    title="Activate this template version"
                  >
                    {activating === template.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  </button>
                )}
                {isAdmin && !template.isActive && (
                  <button
                    onClick={() => handleDelete(template)}
                    disabled={deleting === template.id}
                    className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all disabled:opacity-50"
                    title="Permanently delete this template"
                  >
                    {deleting === template.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {templates.length === 0 && (
        <p className="text-gray-500 text-sm py-8 text-center">No templates uploaded yet</p>
      )}
      {templates.length > 0 && visibleTemplates.length === 0 && (
        <p className="text-gray-500 text-sm py-8 text-center">No templates available in {categoryLabel(categoryFilter)}</p>
      )}

      {selectedTemplate && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">
              Fields in {selectedTemplate.name}
            </h3>
            {isAdmin && !addingField && (
              <button
                onClick={() => setAddingField(true)}
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/20 transition-all"
              >
                + Add Field
              </button>
            )}
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {fields.map((field) => (
              <div key={field.id} className="flex items-center justify-between p-2 rounded bg-white/5">
                {editingFieldId === field.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      autoFocus
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className="flex-1 px-2 py-1 rounded bg-gray-800 border border-gray-600 text-sm text-white"
                    />
                    <button onClick={() => saveEditedLabel(field.id)} className="text-xs text-emerald-400 px-2 hover:text-emerald-300 transition-colors">Save</button>
                    <button onClick={() => setEditingFieldId(null)} className="text-xs text-gray-400 px-2 hover:text-white transition-colors">Cancel</button>
                  </div>
                ) : (
                  <>
                    <div>
                      <p className="text-sm text-white">{field.name}</p>
                      <p className="text-xs text-gray-400">
                        {field.category} {field.isRepeatable && '• Repeats per finding'} {field.isCustom && '• Manual'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="text-xs text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded">
                        {field.normalizedName}
                      </code>
                      {isAdmin && (
                        <button
                          onClick={() => { setEditingFieldId(field.id); setEditLabel(field.name); }}
                          className="text-xs text-gray-400 hover:text-white"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
            {fields.length === 0 && !addingField && (
              <p className="text-gray-500 text-sm py-4 text-center">No fields detected yet</p>
            )}
          </div>

          {addingField && (
            <div className="mt-4 p-3 rounded-lg bg-gray-800/40 border border-gray-700 space-y-2">
              <p className="text-xs text-gray-400">
                Field name must be lowercase, use underscores instead of spaces (e.g. <code>client_contact_email</code>),
                no special characters or brackets, and must not duplicate an existing field on this template. It's used
                internally to match the placeholder during report generation — it doesn't need to match the visible label.
              </p>
              <input
                placeholder="Label (e.g. Client Contact Email)"
                value={newFieldLabel}
                onChange={(e) => {
                  setNewFieldLabel(e.target.value);
                  if (!newFieldName || slugifyFieldName(newFieldName) === slugifyFieldName(newFieldLabel)) {
                    setNewFieldName(slugifyFieldName(e.target.value));
                  }
                }}
                className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 text-sm text-white"
              />
              <div>
                <input
                  placeholder="field_name"
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(slugifyFieldName(e.target.value))}
                  className={`w-full px-3 py-2 rounded-lg bg-gray-800/50 border text-sm font-mono ${
                    newFieldName && isDuplicateFieldName(newFieldName)
                      ? 'border-red-500 text-red-400'
                      : 'border-gray-700 text-emerald-400'
                  }`}
                />
                {newFieldName && isDuplicateFieldName(newFieldName) && (
                  <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> Duplicate field name
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setAddingField(false); setNewFieldLabel(''); setNewFieldName(''); }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={saveNewField}
                  disabled={savingField || !newFieldLabel.trim() || !newFieldName || isDuplicateFieldName(newFieldName)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                >
                  {savingField ? 'Saving...' : 'Save Field'}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template uploader with validation report
// ---------------------------------------------------------------------------

function TemplateUploader() {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [validation, setValidation] = useState<any>(null);
  const [uploadedName, setUploadedName] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    category: 'VAPT',
    // Activity Types for this template; the first is the primary one (sent as subType), the rest as extras.
    subTypes: ['WEB'] as string[],
    reportFormat: 'WORD',
    effectiveFrom: toDateInputValue(new Date()),
  });

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    if (formData.subTypes.length === 0) {
      toast('Select at least one Activity Type.', 'error');
      return;
    }

    const wantedExt = formData.reportFormat === 'EXCEL' ? '.xlsx' : '.docx';
    if (!file.name.toLowerCase().endsWith(wantedExt)) {
      toast(`A ${formData.reportFormat === 'EXCEL' ? 'Excel' : 'Word'} Report needs a ${wantedExt} file. Change the Report Type or choose a ${wantedExt} file.`, 'error');
      return;
    }

    const data = new FormData();
    data.append('file', file);
    data.append('name', formData.name);
    data.append('category', formData.category);
    data.append('subType', formData.subTypes[0]);
    data.append('extraSubTypes', JSON.stringify(formData.subTypes.slice(1)));
    data.append('reportFormat', formData.reportFormat);
    data.append('effectiveFrom', formData.effectiveFrom);

    try {
      setUploading(true);
      setValidation(null);
      const res = await api.post('/reports/templates', data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setValidation(res.data.validation);
      setUploadedName(res.data.name);
      setFile(null);
      setFormData({ ...formData, name: '' });
      toast('Template uploaded');
    } catch (error: any) {
      toast(error.response?.data?.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="glass-card rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-2">Upload Report Template</h2>
        <p className="text-xs text-gray-400 mb-4">
          Templates are versioned: uploads stay as inactive drafts until you review the validation
          report and activate them from the Browse tab. Existing projects keep their original template.
        </p>
        <p className="text-xs text-amber-400/90 mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <strong>How field detection works:</strong> the parser only picks up placeholders written in
          curly braces, e.g. <code>{'{Client Name}'}</code> or <code>{'{Start Date}'}</code>, anywhere in
          the document including tables and the findings table. Use one pair of braces per field (e.g.{' '}
          <code>{'{Start Date}'}</code> and <code>{'{End Date}'}</code> as two separate placeholders, not
          one combined one). Text without braces is left completely untouched and won&apos;t be treated
          as a field, even if it looks like one (e.g. <code>Re-Assessment Date: NA</code> stays static).
        </p>
        <form onSubmit={handleUpload} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Template Name</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Category</label>
              <select
                value={formData.category}
                onChange={(e) => {
                  const category = e.target.value;
                  setFormData({ ...formData, category, subTypes: [category === 'CERT_IN' ? 'APPLICATION' : 'WEB'] });
                }}
                className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700"
              >
                <option value="PCI">PCI</option>
                <option value="VAPT">VAPT</option>
                <option value="CERT_IN">{categoryLabel('CERT_IN')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1" id="activity-types-label">Activity Type</label>
              <div role="group" aria-labelledby="activity-types-label" className="flex flex-wrap gap-1.5">
                {activityTypesFor(formData.category).map((st) => {
                  const on = formData.subTypes.includes(st);
                  return (
                    <button
                      key={st}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFormData({ ...formData, subTypes: on ? formData.subTypes.filter((x) => x !== st) : [...formData.subTypes, st] })}
                      className={`px-2.5 py-1.5 rounded-lg text-xs border transition-all ${
                        on ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30' : 'bg-gray-800/50 text-gray-400 border-gray-700 hover:text-white'
                      }`}
                    >
                      {on && <Check className="inline w-3 h-3 mr-1" />}
                      {subTypeLabels[st] || st}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {formData.subTypes.length === 0 ? 'Select at least one.' : `Selected: ${formData.subTypes.map((st) => subTypeLabels[st] || st).join(', ')}`}
              </p>
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Report Type</label>
            <select
              value={formData.reportFormat}
              onChange={(e) => { setFormData({ ...formData, reportFormat: e.target.value }); setFile(null); }}
              className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700"
            >
              <option value="WORD">Word Report</option>
              <option value="EXCEL">Excel Report</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Effective From</label>
            <input
              type="date"
              value={formData.effectiveFrom}
              onChange={(e) => setFormData({ ...formData, effectiveFrom: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">{formData.reportFormat === 'EXCEL' ? 'XLSX File' : 'DOCX File'}</label>
            <input
              type="file"
              key={formData.reportFormat}
              accept={formData.reportFormat === 'EXCEL' ? '.xlsx' : '.docx'}
              required
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 text-sm file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-medium file:bg-emerald-600 file:text-white hover:file:bg-emerald-500"
            />
          </div>
          <button
            type="submit"
            disabled={uploading || !file}
            className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading & Validating...' : 'Upload Template'}
          </button>
        </form>
      </div>

      {/* Validation report */}
      {validation && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl p-6 space-y-4"
        >
          <h3 className="text-base font-semibold text-white">
            Validation Report — {uploadedName}
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="p-3 rounded-lg bg-gray-800/50">
              <p className="text-gray-500 text-xs">Fields</p>
              <p className="text-white">{validation.fieldCount}</p>
            </div>
            <div className="p-3 rounded-lg bg-gray-800/50">
              <p className="text-gray-500 text-xs">Summary Table</p>
              <p className={validation.hasSummaryTable === null ? 'text-gray-400' : validation.hasSummaryTable ? 'text-emerald-400' : 'text-red-400'}>
                {validation.hasSummaryTable === null ? 'N/A (Excel)' : validation.hasSummaryTable ? 'Detected' : 'Missing'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-gray-800/50">
              <p className="text-gray-500 text-xs">Detailed Table</p>
              <p className={validation.hasDetailedTable === null ? 'text-gray-400' : validation.hasDetailedTable ? 'text-emerald-400' : 'text-red-400'}>
                {validation.hasDetailedTable === null ? 'N/A (Excel)' : validation.hasDetailedTable ? 'Detected' : 'Missing'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-gray-800/50">
              <p className="text-gray-500 text-xs">Dry-Run</p>
              <p className={validation.dryRunOk ? 'text-emerald-400' : 'text-red-400'}>
                {validation.dryRunOk ? 'Passed' : 'Failed'}
              </p>
            </div>
          </div>

          {validation.missingMandatory?.length > 0 && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4">
              <p className="text-sm text-red-400 font-medium mb-2">Missing mandatory elements:</p>
              <ul className="space-y-1">
                {validation.missingMandatory.map((m: string) => (
                  <li key={m} className="text-xs text-gray-300 flex items-center gap-2">
                    <XCircle className="w-3 h-3 text-red-400 shrink-0" /> {m}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {validation.warnings?.length > 0 && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4">
              <ul className="space-y-1">
                {validation.warnings.map((w: string) => (
                  <li key={w} className="text-xs text-amber-300 flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3 shrink-0" /> {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {validation.fieldDiff && (validation.fieldDiff.added.length > 0 || validation.fieldDiff.removed.length > 0) && (
            <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-4 text-xs space-y-1">
              <p className="text-blue-400 font-medium">
                Field changes vs. {validation.fieldDiff.comparedTo || 'previous version'}:
              </p>
              {validation.fieldDiff.added.length > 0 && (
                <p className="text-gray-300">+ Added: {validation.fieldDiff.added.join(', ')}</p>
              )}
              {validation.fieldDiff.removed.length > 0 && (
                <p className="text-gray-300">− Removed: {validation.fieldDiff.removed.join(', ')}</p>
              )}
            </div>
          )}

          <div className={`rounded-lg p-4 text-sm ${
            validation.canActivate
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border border-red-500/20 text-red-400'
          }`}>
            {validation.canActivate
              ? 'Template passed validation. Activate it from the Browse Templates tab when ready.'
              : 'Template has issues — fix the DOCX and re-upload, or activate anyway from Browse Templates if intentional.'}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template Mapping — map each detected template field to an application parameter
// ---------------------------------------------------------------------------

const mappingSelectCls = 'w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm text-white';

function TemplateMapping() {
  const toast = useToast();
  const [templates, setTemplates] = useState<any[]>([]);
  const [parameters, setParameters] = useState<{ key: string; label: string }[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [fields, setFields] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [tRes, pRes] = await Promise.all([
          api.get('/reports/templates/all'),
          api.get('/reports/templates/parameters'),
        ]);
        setTemplates(tRes.data);
        setParameters(pRes.data);
        if (tRes.data.length > 0) setSelectedId(tRes.data[0].id);
      } catch {
        toast('Failed to load templates', 'error');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setFieldsLoading(true);
    api.get(`/reports/templates/${selectedId}/fields`)
      .then((res) => setFields(res.data))
      .catch(() => toast('Failed to load template fields', 'error'))
      .finally(() => setFieldsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const handleMap = async (fieldId: string, mappedParameter: string) => {
    setSavingId(fieldId);
    try {
      const value = mappedParameter || null;
      await api.put(`/reports/templates/fields/${fieldId}`, { mappedParameter: value });
      setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, mappedParameter: value } : f)));
      toast('Mapping saved');
    } catch (error: any) {
      toast(error.response?.data?.message || 'Failed to save mapping', 'error');
    } finally {
      setSavingId(null);
    }
  };

  // Fields mapped to the same application parameter — a real conflict, since
  // both placeholders would be filled with the same value.
  const conflictKeys = new Set(
    Object.entries(
      fields.reduce<Record<string, number>>((acc, f) => {
        if (f.mappedParameter) acc[f.mappedParameter] = (acc[f.mappedParameter] || 0) + 1;
        return acc;
      }, {}),
    )
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ArrowLeftRight className="w-5 h-5 text-emerald-400" />
        <div>
          <h2 className="text-lg font-semibold text-white">Template Parameter Mapping</h2>
          <p className="text-xs text-gray-400">Map each detected template field to the correct application parameter. Saved mappings are used by report generation.</p>
        </div>
      </div>

      {templates.length === 0 ? (
        <p className="text-gray-500 text-sm py-8 text-center">No templates uploaded yet</p>
      ) : (
        <>
          <div className="max-w-md">
            <label className="block text-xs text-gray-400 mb-1">Template</label>
            <select className={mappingSelectCls} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.category} / {t.subType}){!t.isActive ? ' — inactive' : ''}
                </option>
              ))}
            </select>
          </div>

          {fieldsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
            </div>
          ) : fields.length === 0 ? (
            <p className="text-gray-500 text-sm py-8 text-center">No fields detected for this template</p>
          ) : (
            <div className="glass-card rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-left text-gray-400 text-xs">
                    <th className="p-3">Template Field</th>
                    <th className="p-3">Category</th>
                    <th className="p-3">Application Parameter</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => {
                    const conflict = f.mappedParameter ? conflictKeys.has(f.mappedParameter) : false;
                    return (
                      <tr key={f.id} className="border-b border-gray-800 last:border-0">
                        <td className="p-3 text-white">{f.name}</td>
                        <td className="p-3 text-gray-400">{f.category}</td>
                        <td className="p-3">
                          <select
                            className={mappingSelectCls}
                            value={f.mappedParameter || ''}
                            disabled={savingId === f.id}
                            onChange={(e) => handleMap(f.id, e.target.value)}
                          >
                            <option value="">Automatic (no override)</option>
                            {parameters.map((p) => (
                              <option key={p.key} value={p.key}>{p.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="p-3">
                          {conflict ? (
                            <span className="inline-flex items-center gap-1 text-amber-400 text-xs">
                              <AlertTriangle className="w-3.5 h-3.5" /> Conflicts with another field
                            </span>
                          ) : f.mappedParameter ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400 text-xs">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Mapped
                            </span>
                          ) : (
                            <span className="text-gray-500 text-xs">Automatic</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
