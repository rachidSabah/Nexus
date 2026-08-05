# syntax=docker/dockerfile:1
# Multi-stage build for Agent Nexus Gateway
# Produces a slim runtime image with both the gateway server and the dashboard.

# ─── 1. Base ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat python3 make g++
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# ─── 2. Dependencies ────────────────────────────────────────────────────────
# Copy ALL package.json files first so pnpm can resolve the full workspace
# and create node_modules for every package (including workspace symlinks
# like @anx/core → ../../core).
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY turbo.json tsconfig.base.json ./
# Copy all package.json files using a script that finds them.
# This is more maintainable than listing each package individually.
COPY apps/gateway/package.json ./apps/gateway/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY packages/core/package.json ./packages/core/
COPY packages/shared/package.json ./packages/shared/
COPY packages/providers/package.json ./packages/providers/
COPY packages/routing/package.json ./packages/routing/
COPY packages/plugins/package.json ./packages/plugins/
COPY packages/integrations/package.json ./packages/integrations/
COPY packages/networking/package.json ./packages/networking/
COPY packages/security/package.json ./packages/security/
COPY packages/observability/package.json ./packages/observability/
COPY packages/mcp-server/package.json ./packages/mcp-server/
COPY packages/mcp-client/package.json ./packages/mcp-client/
COPY packages/a2a/package.json ./packages/a2a/
COPY packages/agents/package.json ./packages/agents/
COPY packages/runtime/package.json ./packages/runtime/
COPY packages/workflow/package.json ./packages/workflow/
COPY packages/memory/package.json ./packages/memory/
COPY packages/tools/package.json ./packages/tools/
COPY packages/task-router/package.json ./packages/task-router/
COPY packages/persistence/package.json ./packages/persistence/
COPY packages/cli/package.json ./packages/cli/
COPY packages/sdk/package.json ./packages/sdk/
RUN pnpm install --frozen-lockfile || pnpm install

# ─── 3. Build ───────────────────────────────────────────────────────────────
# Copy the entire deps workspace (which has all node_modules + symlinks),
# then overlay the full source code.
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/ .
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ─── 4. Runtime ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
RUN apk add --no-cache libc6-compat tini
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8787

# Copy only what we need at runtime.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=builder /app/apps/gateway/package.json ./apps/gateway/package.json
COPY --from=builder /app/apps/gateway/node_modules ./apps/gateway/node_modules
COPY --from=builder /app/apps/dashboard/.next ./apps/dashboard/.next
COPY --from=builder /app/apps/dashboard/public ./apps/dashboard/public
COPY --from=builder /app/apps/dashboard/package.json ./apps/dashboard/package.json
COPY --from=builder /app/apps/dashboard/node_modules ./apps/dashboard/node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/gateway/agent-nexus.config.example.json ./agent-nexus.config.json

EXPOSE 8787 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/gateway/dist/bin.js"]
