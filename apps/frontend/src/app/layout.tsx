import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/auth-context';
import { ToastProvider } from '@/components/toast-provider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'STT',
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
        <AuthProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
