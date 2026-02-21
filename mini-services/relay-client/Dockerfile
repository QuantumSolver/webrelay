# ===========================================
# CRM Relay Client - Dockerfile
# ===========================================
# Lightweight Bun service for consuming webhooks
# Runs on LOCAL/INTERNAL server, forwards to internal services

FROM oven/bun:1-slim

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy application code
COPY index.ts ./

# Create non-root user
RUN addgroup --system --gid 1001 relay && \
    adduser --system --uid 1001 relay

# Set ownership
RUN chown -R relay:relay /app

USER relay

# Expose health check port
EXPOSE 3003

# Environment defaults
ENV CLIENT_PORT=3003
ENV WORKER_COUNT=5
ENV BATCH_SIZE=10
ENV BLOCK_TIMEOUT=5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3003/health || exit 1

# Run the client
CMD ["bun", "run", "index.ts"]
