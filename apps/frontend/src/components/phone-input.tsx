'use client';

import { useState } from 'react';

const CODES = ['+91', '+1', '+44', '+61', '+65', '+971', '+966', '+49', '+33', '+81', '+86', '+92', '+94', '+880', '+977'];

// Split a stored "+CC number" into its parts; numbers with no country code default to +91.
const split = (v: string): [string, string] => {
  const t = (v || '').trim();
  if (!t.startsWith('+')) return ['+91', t];
  const m = t.match(/^(\+\d+)[\s-]+(.*)$/);
  if (m) return [m[1], m[2]];
  const known = [...CODES].sort((a, b) => b.length - a.length).find((c) => t.startsWith(c));
  return known ? [known, t.slice(known.length)] : ['+91', t];
};

/** Country code (editable, default +91) + number. `value`/`onChange` use the stored "+CC number" string. */
export function PhoneInput({ value, onChange, className = '' }: { value: string; onChange: (v: string) => void; className?: string }) {
  const [code, setCode] = useState(() => split(value)[0]);
  const num = split(value)[1];
  const emit = (c: string, n: string) => onChange(n.trim() ? `${c.trim() || '+91'} ${n.trim()}` : '');
  const field = `px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 text-sm ${className}`;
  return (
    <div className="flex gap-2">
      <input
        list="phone-codes"
        aria-label="Country code"
        value={code}
        onChange={(e) => { const c = '+' + e.target.value.replace(/\D/g, ''); setCode(c); emit(c, num); }}
        className={`${field} w-24`}
      />
      <datalist id="phone-codes">{CODES.map((c) => <option key={c} value={c} />)}</datalist>
      <input
        type="tel"
        aria-label="Phone number"
        value={num}
        onChange={(e) => emit(code, e.target.value)}
        className={`${field} flex-1 min-w-0`}
      />
    </div>
  );
}
