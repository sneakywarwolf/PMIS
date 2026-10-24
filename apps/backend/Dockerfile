# Multi-stage build for production
# Stage 1: Builder
FROM node:22-alpine AS builder

WORKDIR /app

# Prisma's query engine needs OpenSSL on Alpine
RUN apk add --no-cache openssl

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build application
RUN npm run build && find dist -name "*.map" -delete

# Drop dev dependencies (prisma CLI + ts-node stay: they are runtime deps for migrate/seed),
# then regenerate the Prisma client because prune removes node_modules/.prisma
RUN npm prune --omit=dev && npx prisma generate

# Stage 2: Production
FROM node:22-alpine AS production

WORKDIR /app

# Pull patched Alpine packages (musl, zlib, openssl) and a current npm (the base image's bundled copy
# carries vulnerable tar/minimatch/etc.); Prisma's query engine needs OpenSSL on Alpine
RUN apk upgrade --no-cache && apk add --no-cache openssl && npm install -g npm@latest

# Set Node.js to production
ENV NODE_ENV=production

# Builder's pruned node_modules (prod deps incl. prisma CLI + ts-node for migrate/seed at start)
COPY package*.json tsconfig.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:4000/settings/public-theme', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Apply migrations, seed (idempotent; creates the admin user on first run), then start
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/src/main"]
