# syntax=docker/dockerfile:1
# Agent Nexus Gateway — Docker image
# Single-stage build for reliability (pnpm workspace symlinks don't
# survive multi-stage COPY reliably).

FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat python3 make g++ tini

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

# Copy everything (respecting .dockerignore which excludes node_modules, dist, .next, etc.)
COPY . .

# Install all dependencies (this sets up workspace symlinks correctly)
RUN pnpm install --frozen-lockfile || pnpm install

# Build all packages
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ─── Runtime ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
RUN apk add --no-cache libc6-compat tini
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8787

# Run as non-root for security (Phase 16 §16).
RUN addgroup -S nexus && adduser -S nexus -G nexus

# Copy built application — owned by the nexus user so the process can write
# runtime config files (agent-nexus.config.json, temp pids, etc.)
COPY --from=builder --chown=nexus:nexus /app/package.json ./package.json
COPY --from=builder --chown=nexus:nexus /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder --chown=nexus:nexus /app/node_modules ./node_modules
COPY --from=builder --chown=nexus:nexus /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=builder --chown=nexus:nexus /app/apps/gateway/package.json ./apps/gateway/package.json
COPY --from=builder --chown=nexus:nexus /app/apps/gateway/node_modules ./apps/gateway/node_modules
COPY --from=builder --chown=nexus:nexus /app/apps/dashboard/.next ./apps/dashboard/.next
COPY --from=builder --chown=nexus:nexus /app/apps/dashboard/package.json ./apps/dashboard/package.json
COPY --from=builder --chown=nexus:nexus /app/apps/dashboard/node_modules ./apps/dashboard/node_modules
COPY --from=builder --chown=nexus:nexus /app/packages ./packages
COPY --from=builder --chown=nexus:nexus /app/apps/gateway/agent-nexus.config.example.json ./agent-nexus.config.json
EXPOSE 8787 3000

USER nexus

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:8787/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/gateway/dist/bin.js"]
