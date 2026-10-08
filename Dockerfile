# syntax=docker/dockerfile:1
# Imagem única do Studio Pilari para o Cloud Run:
# o NestJS serve a API (/api) e o SPA do React (build do Vite) na mesma origem.

############################
# Stage 1 — build do monorepo
############################
FROM node:22-slim AS build
WORKDIR /app

# pnpm na mesma versão do packageManager do repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# 1) Só os manifests primeiro → camada de cache da instalação
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json tsconfig.json ./
COPY types/package.json types/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/

# Instala TODAS as deps do workspace (inclui dev, necessárias para buildar)
RUN pnpm install --frozen-lockfile

# 2) Resto do código (respeitando .dockerignore; apps/client/.env entra aqui)
COPY . .

# 3) Build: types → client (Vite) → server (Nest)
RUN pnpm --filter @pilari/types build \
 && pnpm --filter client build \
 && pnpm --filter server build

# 4) Empacota o server como app standalone de produção:
#    node_modules reais (sem symlinks do pnpm) + @pilari/types injetado.
#    dist/drizzle não vêm no deploy (estão no .gitignore), então copiamos à mão.
#    O build do client vira a pasta public/ servida pelo Nest.
RUN pnpm --filter server deploy --prod /app/deploy \
 && cp -r apps/server/dist    /app/deploy/dist \
 && cp -r apps/server/drizzle /app/deploy/drizzle \
 && cp -r apps/client/dist    /app/deploy/public

############################
# Stage 2 — runtime enxuto
############################
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Apenas o pacote standalone (node_modules prod + dist + drizzle + public)
COPY --from=build /app/deploy ./

# Least-privilege: roda como o usuário não-root `node` (já existe na imagem oficial).
# Um RCE na aplicação não vira root no container.
USER node

# Cloud Run injeta PORT (8080). main.ts faz listen em 0.0.0.0:$PORT.
EXPOSE 8080
CMD ["node", "dist/main.js"]
