'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { Radio, Plug, Unplug, Send } from 'lucide-react';
import { useToast } from '@/components/toast-provider';
import { connectEasterEgg } from '@/lib/easter-egg/socket';

type Row = {
  id: string;
  name: string;
  role: string;
  stage: 'restricted' | 'terminal' | 'revealed';
  attempts: number;
  max: number;
  lastActive: number;
  admin: string | null;
  mode: 'AUTO' | 'MANUAL';
};
type Line = { id: number; kind: string; text: string };

const MAX_LINES = 200;
const MAX_TEXT = 256;
const STAGE_LABEL = { restricted: 'Access Restricted', terminal: 'In Terminal', revealed: 'Finale' };
const LINE_CLS: Record<string, string> = {
  in: 'text-gray-300',
  out: 'text-emerald-300',
  sys: 'text-emerald-500/70',
  paste: 'text-amber-300',
  admin: 'text-cyan-300',
};

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

// Mirrored text lives only in this component's state and is dropped on disconnect/unmount.
export function LiveMonitor() {
  const toast = useToast();
  const [online, setOnline] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [clockSkew, setClockSkew] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [value, setValue] = useState('');
  const [, tick] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const heldRef = useRef<string | null>(null);
  heldRef.current = held;
  const nextId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const push = (kind: string, text: string) =>
    setLines((prev) => [...prev, { id: nextId.current++, kind, text }].slice(-MAX_LINES));

  useEffect(() => {
    const s = connectEasterEgg();
    socketRef.current = s;
    s.on('connect', () => {
      setOnline(true);
      s.emit('ee:list');
    });
    s.on('disconnect', () => {
      setOnline(false);
      setHeld(null);
      setLines([]);
    });
    s.on('ee:sessions', (d: { now: number; sessions: Row[] }) => {
      setRows(Array.isArray(d?.sessions) ? d.sessions : []);
      setClockSkew(Date.now() - d.now);
    });
    s.on('ee:mirror', (m: { sessionId: string; kind: string; text: string }) => {
      if (m?.sessionId === heldRef.current && typeof m.text === 'string') push(m.kind, m.text);
    });
    s.on('ee:ended', ({ sessionId }: { sessionId: string }) => {
      if (sessionId === heldRef.current) {
        setHeld(null);
        setLines([]);
        toast('User left the session', 'info');
      }
    });
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => {
      clearInterval(t);
      s.disconnect();
      socketRef.current = null;
    };
  }, [toast]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const sel = rows.find((r) => r.id === selected) ?? null;
  const isHeld = !!sel && held === sel.id;

  const connect = () => {
    if (!sel) return;
    socketRef.current?.emit('ee:connect', { sessionId: sel.id }, (res: { ok: boolean; error?: string }) => {
      if (res?.ok) {
        setHeld(sel.id);
        setLines([]);
        push('sys', `Connected to ${sel.name}. They can see that you are connected.`);
      } else {
        toast(res?.error === 'busy' ? 'Another admin is already connected to this session' : 'Session is no longer available', 'error');
      }
    });
  };

  const disconnect = () => {
    if (!held) return;
    socketRef.current?.emit('ee:release', { sessionId: held });
    setHeld(null);
    setLines([]);
  };

  const setMode = (mode: 'AUTO' | 'MANUAL') => {
    if (held) socketRef.current?.emit('ee:mode', { sessionId: held, mode });
  };

  const say = (e: FormEvent) => {
    e.preventDefault();
    const text = value.trim();
    if (!held || !text) return;
    socketRef.current?.emit('ee:say', { sessionId: held, text });
    push('admin', `operator> ${text}`);
    setValue('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Radio className="w-4 h-4 text-emerald-400" /> Live Terminal Monitor
        </h3>
        <span className={`text-xs ${online ? 'text-emerald-400' : 'text-gray-500'}`}>{online ? `● Online · ${rows.length} active` : '○ Offline'}</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-black/20 text-xs text-gray-400">
            <tr>
              <th className="text-left px-3 py-2">User Name</th>
              <th className="text-left px-3 py-2">Role</th>
              <th className="text-left px-3 py-2">Session Status</th>
              <th className="text-left px-3 py-2">Live Terminal Activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-xs text-gray-500">
                  Nobody is at the Access Restricted door right now.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => setSelected(r.id)}
                className={`cursor-pointer border-t border-gray-800 ${selected === r.id ? 'bg-emerald-500/10' : 'hover:bg-white/5'}`}
              >
                <td className="px-3 py-2 text-gray-200">{r.name}</td>
                <td className="px-3 py-2 text-gray-400">{r.role.replace(/_/g, ' ')}</td>
                <td className="px-3 py-2">
                  <span className="text-gray-300">{STAGE_LABEL[r.stage] ?? r.stage}</span>
                  {r.admin && (
                    <span className="ml-2 text-xs text-cyan-300">
                      ● Live · {r.admin}
                      {r.mode === 'MANUAL' ? ' · MANUAL' : ''}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-400">
                  {r.attempts}/{r.max} attempts · active {ago(Date.now() - clockSkew - r.lastActive)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sel && (
        <div className="rounded-lg border border-emerald-500/20 bg-black/30 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-emerald-500/20">
            <span className="text-xs font-mono text-emerald-400/80">
              {sel.name} — {isHeld ? 'mirrored console' : 'not connected'}
            </span>
            <div className="flex items-center gap-2">
              {isHeld && (
                <div className="flex rounded-md overflow-hidden border border-gray-700 text-xs">
                  {(['AUTO', 'MANUAL'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      aria-pressed={sel.mode === m}
                      className={`px-3 py-1 ${sel.mode === m ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
              {isHeld ? (
                <button onClick={disconnect} className="flex items-center gap-1 px-3 py-1 rounded-md text-xs bg-red-500/10 text-red-300 hover:bg-red-500/20">
                  <Unplug className="w-3.5 h-3.5" /> Disconnect
                </button>
              ) : (
                <button
                  onClick={connect}
                  disabled={!online || (!!sel.admin && held !== sel.id)}
                  className="flex items-center gap-1 px-3 py-1 rounded-md text-xs bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"
                >
                  <Plug className="w-3.5 h-3.5" /> Connect
                </button>
              )}
            </div>
          </div>

          <div ref={scrollRef} className="h-56 overflow-y-auto px-3 py-2 font-mono text-xs space-y-0.5">
            {!isHeld && <p className="text-gray-500">Connect to mirror this session. Nothing is shown or stored until you do.</p>}
            {lines.map((l) => (
              <p key={l.id} className={`whitespace-pre-wrap break-words ${LINE_CLS[l.kind] ?? 'text-gray-400'}`}>
                {l.text}
              </p>
            ))}
          </div>

          {isHeld && (
            <form onSubmit={say} className="flex items-center gap-2 px-3 py-2 border-t border-emerald-500/20">
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                maxLength={MAX_TEXT}
                disabled={sel.mode !== 'MANUAL'}
                placeholder={sel.mode === 'MANUAL' ? 'Reply as operator (plain text)' : 'Switch to MANUAL to respond'}
                aria-label="Operator reply"
                className="flex-1 !bg-transparent !border-0 font-mono text-xs text-cyan-200 placeholder:text-gray-600 outline-none focus:ring-0 disabled:opacity-50"
              />
              <button type="submit" disabled={sel.mode !== 'MANUAL' || !value.trim()} className="text-cyan-300 disabled:opacity-30" aria-label="Send">
                <Send className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
