# Studio Pilari — Plataforma de cursos

Plataforma de cursos online do **Studio Pilari** (Pilates e Fisioterapia, Colombo/PR), com aulas em vídeo,
provas por módulo, certificado de conclusão com QR de verificação, venda com Pix/boleto/cartão (Asaas) e
app instalável (PWA). Os cursos são conduzidos pela Dra. Mylena Sestream.

Monorepo **pnpm workspaces + Turborepo**:

```
apps/
├── client/   # Vite + React 19 + TypeScript (FSD) — porta 5173
└── server/   # NestJS 11 + Drizzle/MySQL — porta 3001 no dev
types/        # @pilari/types — DTOs compartilhados
```

O servidor serve a API em `/api` e, em produção, o SPA do client na mesma origem.

## Marca

| O quê | Onde |
|---|---|
| Cores (verde sálvia + rosa) | `apps/client/src/app/styles/colors.css` e `DEFAULT_*_COLOR` em `apps/server/src/modules/tenancy/branding.ts` |
| Fonte Inter (OFL) | `apps/client/public/fonts` + `apps/client/src/app/styles/fonts.css` |
| Logo (símbolo + nome) | `apps/client/src/shared/ui/PilariLogo.tsx`, favicon em `apps/client/public/brand/favicon.svg` |
| Ícones do app (PWA) | `apps/client/public/icons/pilari-*.png` |
| Contatos, endereço, Instagram | `apps/client/src/shared/config/brand.ts` |
| Arte do certificado | `apps/server/src/modules/certificate/assets/certificate-template.png` (fonte: `certificate-template.source.html`) |
| Dados da matriz no banco | migration `apps/server/drizzle/0034_multi_polo_fundacao.sql` (tenant `pilari`) |

## Pré-requisitos

- Node >= 22.12
- pnpm 9

## Comandos (raiz)

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter client test
pnpm --filter server test
pnpm --filter server test:integration   # MySQL 8 descartável (mysql-memory-server)
```

## Rodar localmente sem nenhum serviço externo

1. MySQL descartável: `pnpm --filter server exec tsx test/e2e/start-local-db.ts` (porta 3399).
2. Login: `npx firebase-tools@14 emulators:start --only auth --project demo-pilari` (porta 9099).
3. Servidor (as migrations rodam sozinhas na subida):
   `NODE_ENV=development PORT=3001 DATABASE_URL=mysql://root@127.0.0.1:3399/ead_ensaio FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=demo-pilari AUTH_REQUIRED=1 THROTTLE_DISABLED=1 pnpm --filter server start`
4. Client: `VITE_FIREBASE_API_KEY=demo VITE_FIREBASE_PROJECT_ID=demo-pilari VITE_FIREBASE_AUTH_DOMAIN=demo-pilari.firebaseapp.com VITE_FIREBASE_APP_ID=1:0:web:0 VITE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099 pnpm --filter client dev`

> **Atenção:** as migrations do Drizzle rodam na subida do servidor. Nunca suba o servidor local com um
> `DATABASE_URL` de produção.

## O que falta configurar para produção

- Banco MySQL próprio (`DATABASE_URL`).
- Projeto Firebase próprio (login): `apps/client/.env.production` e `FIREBASE_SERVICE_ACCOUNT_BASE64`.
- Conta Asaas do Studio Pilari (`ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`).
- Armazenamento de vídeos e anexos (`GCS_BUCKET`) — ou aulas por link do YouTube.
- Renderizador de PDF do certificado (`PDF_SYNTH_URL`): não há endereço padrão no código.
- Domínio (`TENANT_BASE_DOMAIN`, `WEB_PUBLIC_URL`).
