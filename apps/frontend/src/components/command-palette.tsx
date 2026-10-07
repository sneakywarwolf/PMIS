'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { CornerDownLeft, FolderOpen, Search } from 'lucide-react';
import { api } from '@/contexts/auth-context';
import type { Row } from '@/lib/use-engagements';

type Page = { label: string; href: string; icon: React.ElementType };
type Item = { key: string; label: string; hint: string; href: string; icon: React.ElementType };

/**
 * ⌘K / Ctrl+K quick switcher: jump to a page or a project. Projects come from
 * the existing /dashboard/engagements endpoint (already role-scoped server-side),
 * fetched once, the first time the palette opens.
 */
export function CommandPalette({ pages, open, onOpenChange }: {
  pages: Page[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [projects, setProjects] = useState<Row[]>([]);
  const loaded = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    if (loaded.current) return;
    loaded.current = true;
    api.get('/dashboard/engagements', { params: { view: 'team' } })
      .then((r) => setProjects(r.data))
      .catch(() => { loaded.current = false; });
  }, [open]);

  const items: Item[] = useMemo(() => {
    const all: Item[] = [
      ...pages.map((p) => ({ key: p.href, label: p.label, hint: 'Page', href: p.href, icon: p.icon })),
      ...projects.map((r) => ({ key: r.id, label: r.clientName, hint: r.scope || r.name, href: `/dashboard/projects/${r.id}`, icon: FolderOpen })),
    ];
    const q = query.trim().toLowerCase();
    return (q ? all.filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(q)) : all).slice(0, 30);
  }, [pages, projects, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (item?: Item) => {
    if (!item) return;
    onOpenChange(false);
    router.push(item.href);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[15vh] z-[160] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-2xl focus:outline-none"
        >
          <Dialog.Title className="sr-only">Quick search</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-gray-700 px-4">
            <Search className="w-4 h-4 shrink-0 text-gray-500" />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls="command-list"
              aria-activedescendant={items[active] ? `cmd-${items[active].key}` : undefined}
              aria-label="Search pages and projects"
              placeholder="Search pages and projects…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                else if (e.key === 'Enter') { e.preventDefault(); go(items[active]); }
              }}
              className="w-full border-0 bg-transparent px-0 py-3 text-sm text-white placeholder:text-gray-500 focus:shadow-none focus:outline-none"
            />
            <kbd className="rounded border border-gray-700 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">Esc</kbd>
          </div>

          <ul id="command-list" role="listbox" ref={listRef} className="max-h-80 overflow-y-auto p-2">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-gray-500">No results</li>}
            {items.map((item, i) => (
              <li
                key={item.key}
                id={`cmd-${item.key}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => go(item)}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  i === active ? 'bg-emerald-500/10 text-white' : 'text-gray-300'
                }`}
              >
                <item.icon className={`w-4 h-4 shrink-0 ${i === active ? 'text-emerald-400' : 'text-gray-500'}`} />
                <span className="truncate">{item.label}</span>
                <span className="ml-auto truncate text-xs text-gray-500">{item.hint}</span>
                {i === active && <CornerDownLeft className="w-3.5 h-3.5 shrink-0 text-gray-500" />}
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
