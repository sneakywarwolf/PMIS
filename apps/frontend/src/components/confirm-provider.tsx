'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<(v: boolean) => void>();

  const confirm: ConfirmFn = useCallback((options) => {
    const opts = typeof options === 'string' ? { message: options } : options;
    setState(opts);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const close = (result: boolean) => {
    resolveRef.current?.(result);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AnimatePresence>
        {state && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => close(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 6 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className={`w-full max-w-sm rounded-xl border backdrop-blur-md shadow-2xl p-5 ${
                state.danger
                  ? 'bg-red-500/10 border-red-500/30'
                  : 'bg-gray-900/90 border-gray-700'
              }`}
            >
              <div className="flex items-start gap-3 mb-4">
                <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${state.danger ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                  <AlertTriangle className="w-4.5 h-4.5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{state.title || 'Are you sure?'}</p>
                  <p className="text-sm text-gray-400 mt-1">{state.message}</p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => close(false)}
                  className="px-4 py-1.5 rounded-lg text-sm text-gray-300 hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => close(true)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    state.danger
                      ? 'bg-red-600 hover:bg-red-500 text-white'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  {state.confirmLabel || 'Confirm'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}
