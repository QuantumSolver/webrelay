# ===========================================
# Realtime Service - Dockerfile
# ===========================================
# Socket.io service for real-time dashboard updates
# Should be deployed alongside Relay Server

FROM oven/bun:1-slim

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy application code
COPY index.ts ./

# Create non-root user
RUN groupadd --system --gid 1001 realtime && \
    useradd --system --uid 1001 --gid realtime realtime

# Set ownership
RUN chown -R realtime:realtime /app

USER realtime

# Expose WebSocket port
EXPOSE 3004

# Environment defaults
ENV PORT=3004

# Health check (WebSocket doesn't have HTTP endpoints, skip)
# HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
#     CMD curl -f http://localhost:3004/health || exit 1

# Run the service
CMD ["bun", "run", "index.ts"]
