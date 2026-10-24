import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { MotionConfig } from 'framer-motion';
import './globals.css';
import { AuthProvider } from '@/contexts/auth-context';
import { BrandingProvider } from '@/contexts/branding-context';
import { ThemeProvider } from '@/contexts/theme-context';
import { ToastProvider } from '@/components/toast-provider';
import { ConfirmProvider } from '@/components/confirm-provider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'PMIS - Project Management for Information Security',
  description: 'Security Testing Tool — by a Lazy Tester For Lazy Testers',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  // Same precedence as ThemeProvider: user override -> last known admin default -> (none = system default)
                  const theme = localStorage.getItem('pmis-theme-override') || localStorage.getItem('pmis-theme-admin-default');
                  if (theme) document.documentElement.dataset.theme = theme;
                } catch (e) {}
              })();
            `,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const observer = new MutationObserver(function(mutations) {
                  mutations.forEach(function(mutation) {
                    if (mutation.type === 'attributes') {
                      const name = mutation.attributeName;
                      if (name && (name.indexOf('data-gr-') === 0 || name.indexOf('data-new-gr-') === 0)) {
                        mutation.target.removeAttribute(name);
                      }
                    }
                  });
                });
                observer.observe(document.documentElement, { attributes: true, subtree: true, attributeOldValue: true });
              })();
            `,
          }}
        />
      </head>
      <body suppressHydrationWarning className={`${inter.className} bg-cyber-bg text-gray-100 min-h-screen`}>
        <MotionConfig reducedMotion="user">
          <AuthProvider>
            <BrandingProvider>
              <ThemeProvider>
                <ToastProvider>
                  <ConfirmProvider>
                  {children}
                  </ConfirmProvider>
                </ToastProvider>
              </ThemeProvider>
            </BrandingProvider>
          </AuthProvider>
        </MotionConfig>
      </body>
    </html>
  );
}
