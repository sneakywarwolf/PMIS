import { AlertTriangle } from 'lucide-react';

/** Shown under "Testing Limitation" on Network projects: the standard wording for authentication limitations. */
export function NetworkLimitationCaution() {
  return (
    <div role="note" className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        Caution: when adding a limitation for a Network project, mention:
      </p>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-gray-300">
        <li>Authentication could not be performed on &lt;IP Address&gt; as the system does not support credentialed access; therefore, an unauthenticated scan was conducted.</li>
        <li>&lt;IP Address&gt; is not within our administrative control, and credentials could not be provisioned; hence, only an unauthenticated scan was carried out.</li>
        <li>Mention any other limitations.</li>
      </ul>
    </div>
  );
}
