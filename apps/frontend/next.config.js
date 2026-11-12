/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server for the Docker image (see Dockerfile): only the files the app uses are copied into the image.
  output: 'standalone',
  images: {
    domains: ['localhost'],
  },
  // Disable persistent webpack cache in dev to prevent chunk corruption
  // when files are edited during compilation.
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = false;
    }
    return config;
  },
  poweredByHeader: false,
  experimental: {
    // Next's /api proxy copies the request body only up to this size (10 MB by default) and cuts off the rest,
    // which breaks every larger upload. Nessus scans can be up to 500 MB (plus multipart overhead, hence 512).
    middlewareClientMaxBodySize: '512mb',
    // How long the proxy waits on the API without any traffic (30 s by default). Importing a big scan takes longer.
    proxyTimeout: 15 * 60 * 1000,
  },
  async headers() {
    const dev = process.env.NODE_ENV !== 'production';
    // 'unsafe-inline' is needed for Next's inline bootstrap and the static theme script in layout.tsx;
    // 'unsafe-eval' and ws:/wss: only for the dev server. HSTS is left to the HTTPS terminator.
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // globals.css @imports Google Fonts
      "img-src 'self' data: blob:", // no remote images: Cyberdigest and article content never load third-party pictures or tracking pixels
      "font-src 'self' data: https://fonts.gstatic.com",
      `connect-src 'self'${dev ? ' ws: wss:' : ''}`, // the only socket (/easter-egg) is same-origin long-polling; ws: only for the dev hot-reload socket
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Not shared with other origins' windows or embedders (no cross-origin popups or embeds are used). COEP is left off:
          // require-corp would block the Google Fonts stylesheet.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        // Evaluated at build time. The Docker image builds with BACKEND_URL=http://backend:4000.
        destination: `${process.env.BACKEND_URL || 'http://localhost:4000'}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
