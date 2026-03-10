# DevHttp

Monorepo do DevHttp com:

- `apps/web`: cliente web em Next.js
- `apps/api`: API NestJS
- `apps/desktop`: shell Electron
- `packages/shared`: tipos compartilhados

## Rodando localmente

1. `cp .env.example .env`
2. `npm install`
3. `npm run db:up`
4. `npm run db:migrate -- --name init` na primeira vez
5. `npm run db:seed`
6. `npm run dev:api`
7. Em outro terminal: `npm run dev:web`
8. Opcional: `npm run dev:desktop`

## Desktop

- O desktop usa Electron como shell do app hospedado
- Em desenvolvimento, abre `http://localhost:3000`
- Empacotado, abre `https://devhttp.marcelocorrea.com.br`
- Build local recomendado:
  - `npm run dist:desktop:linux`
- Build de release para download:
  - Windows via GitHub Actions em `windows-latest`
  - macOS via GitHub Actions em `macos-latest`
  - Linux via GitHub Actions em `ubuntu-latest`
- Workflow de release:
  - `.github/workflows/desktop-release.yml`
  - dispara por tag `desktop-v*`
  - também pode ser executada manualmente com `workflow_dispatch`
- Distribuição via GitHub Releases

## Banco de dados

- MySQL 8 via `compose.yaml`
- Prisma como ORM
- Migrations em `apps/api/prisma/migrations`
- Seed em `apps/api/prisma/seed.ts`
- Prisma Studio: `npm run db:studio`

## Credenciais seed

- Email: `admin@devhttp.local`
- Senha: `devhttp123`

As credenciais seed podem variar por ambiente em produção, conforme `/etc/devhttp/devhttp.env`.

## Deploy em produção

O repositório inclui artefatos para deploy em uma VPS Ubuntu com:

- Apache como reverse proxy
- Next.js em `127.0.0.1:3000`
- NestJS em `127.0.0.1:4000`
- MySQL 8 nativo na VPS
- `systemd` para gerenciar os serviços
- Certificado TLS com Certbot

Fluxo esperado:

1. Provisionar a VPS com `scripts/bootstrap-vps.sh`
2. Criar `/etc/devhttp/devhttp.env` com as variáveis de produção
3. Publicar o repositório no GitHub
4. Configurar os secrets do GitHub Actions
5. Fazer push na `main`

Arquivos relevantes:

- workflow: `.github/workflows/deploy.yml`
- Apache: `deploy/apache/devhttp.conf`
- systemd: `deploy/systemd/devhttp-api.service` e `deploy/systemd/devhttp-web.service`
- script remoto de deploy: `scripts/deploy-remote.sh`
- bootstrap da VPS: `scripts/bootstrap-vps.sh`

## O que já está implementado

- Login com sessão simples por token persistido no banco
- Workspace e projeto seed carregados via Prisma seed
- Requests salvos com método, URL, headers, query params, body e script pós-request
- Ambientes com variáveis interpoladas no backend
- Execução HTTP via proxy do backend
- Importação e exportação básica no formato Postman
- Shell Electron apontando para a versão web
