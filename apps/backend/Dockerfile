# Multi-stage build for production
# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Prisma engines need openssl on alpine
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
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
# Cap V8 heap below the container limit so Node GCs instead of being OOM-killed
ENV NODE_OPTIONS=--max-old-space-size=1024

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/

# ponytail: full node_modules (incl. prisma CLI + generated client) so `migrate deploy`
# runs at start; slimmer image possible by running migrations as a separate job.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

RUN addgroup -g 1001 -S nodejs &&     adduser -S nodejs -u 1001 &&     chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3     CMD node -e "require('http').get('http://localhost:4000/api/docs', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Apply pending migrations (Prisma takes an advisory lock, safe with replicas), then start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
