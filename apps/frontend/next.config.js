/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
    // 'unsafe-eval' only for the dev server. ws:/wss: = Socket.IO. HSTS is left to the HTTPS terminator.
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // globals.css @imports Google Fonts
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' ws: wss:",
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
