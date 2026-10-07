'use client';

import { motion } from 'framer-motion';

/**
 * Shown by the router while a dashboard page's code is loading. The sidebar/top bar (layout) stay
 * mounted, so only the content area shows this. It fades in after a short delay, so fast navigations
 * never flash a spinner, and slower ones get a smooth indicator instead of a blank or frozen screen.
 */
export default function DashboardLoading() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25, delay: 0.15, ease: 'easeOut' }}
      className="flex min-h-[40vh] items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-500" />
    </motion.div>
  );
}
