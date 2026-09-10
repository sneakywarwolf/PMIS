'use client';

import { useEffect, useState } from 'react';
import { FileCog, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth, api } from '@/contexts/auth-context';
import { useToast } from '@/components/toast-provider';

interface Template {
  id: string;
  name: string;
  category: string;
  subType: string;
  isActive: boolean;
}

interface TemplateField {
  id: string;
  name: string;
  normalizedName: string;
  category: string;
  mappedParameter: string | null;
}

interface Parameter {
  key: string;
  label: string;
}

const selectCls = 'w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm text-white';

export default function ReportTemplatesPage() {
  const { user } = useAuth();
  if (user?.role !== 'ADMIN') {
    return (
      <div className="text-center py-12">
        <p className="text-red-400">Access denied. Admin privileges required.</p>
      </div>
    );
  }
  return <TemplateMappingContent />;
}

function TemplateMappingContent() {
  const toast = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [parameters, setParameters] = useState<Parameter[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [fields, setFields] = useState<TemplateField[]>([]);
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
      toast('Mapping saved', 'success');
    } catch {
      toast('Failed to save mapping', 'error');
    } finally {
      setSavingId(null);
    }
  };

  // Fields that map to the same application parameter — a real conflict:
  // two template placeholders would both be filled with the same value.
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
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileCog className="w-6 h-6 text-emerald-400" />
        <div>
          <h1 className="text-xl font-semibold text-white">Report Template Field Mapping</h1>
          <p className="text-sm text-gray-500">Map each template placeholder to the correct application parameter.</p>
        </div>
      </div>

      {templates.length === 0 ? (
        <p className="text-gray-500">No templates uploaded yet.</p>
      ) : (
        <>
          <div className="max-w-md">
            <label className="block text-xs text-gray-400 mb-1">Template</label>
            <select className={selectCls} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
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
            <p className="text-gray-500">No fields detected for this template.</p>
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
                            className={selectCls}
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
