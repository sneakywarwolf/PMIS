'use client';

import { motion } from 'framer-motion';

/** Fades a dashboard section in with a short upward move as it enters the viewport. */
export function RevealSection({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.4, ease: 'easeOut', delay }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">{children}</h2>;
}
