# Multi-stage build for production
# Stage 1: Builder
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Backend URL for the /api proxy rewrite (baked at build time)
ARG BACKEND_URL=http://backend:4000
ENV BACKEND_URL=$BACKEND_URL

# Copy source code
COPY . .

# Backend address baked into the /api proxy; matches the service name in docker-compose.yml
ARG BACKEND_URL=http://backend:4000
ENV BACKEND_URL=$BACKEND_URL

# Build application
RUN npm run build

# Stage 2: Production
# Next's "standalone" output: the server plus only the files it actually uses (traced at build time). No source, no dev
# dependencies and, because nothing in this image runs npm, no npm at all: the base image's bundled npm and its
# dependencies are a source of scanner findings and are not needed to run the app.
FROM node:22-alpine AS production

WORKDIR /app

# Pull patched Alpine packages (musl, zlib, openssl) and remove the unused package managers.
RUN apk upgrade --no-cache     && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack               /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn* /usr/local/bin/pnpm* 2>/dev/null; true

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The compiled server and its traced dependencies, then the static assets and public files it serves.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY forwarded-for.js ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs &&     adduser -S nextjs -u 1001

# Change ownership
RUN chown -R nextjs:nodejs /app

# forwarded-for.js makes the client address in X-Forwarded-For trustworthy for the backend's per-IP rate limits.
ENV NODE_OPTIONS="--max-old-space-size=1024 --require /app/forwarded-for.js"
USER nextjs

# Expose port
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3     CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1

# Start application
CMD ["node", "server.js"]
