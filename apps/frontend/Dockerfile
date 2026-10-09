# Multi-stage build for production
# Stage 1: Builder
FROM node:20-alpine AS builder

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
FROM node:20-alpine AS production

WORKDIR /app

# Set Node.js to production
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=1024

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Copy compiled application from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Change ownership
RUN chown -R nextjs:nodejs /app
USER nextjs

# Expose port
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \n    CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1

# Start application
CMD ["npm", "start"]
