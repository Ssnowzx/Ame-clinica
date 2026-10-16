# Ame Clínica

Sistema de gestão e agendamento da **Ame Clínica**, construído sobre o produto Xclinicas.
É um sistema de **clínica única** (não há multi-tenant). Cobre agenda, pacientes,
tratamentos/pacotes, atendimentos e evoluções, financeiro (caixa, DRE, repasse, convênios),
comunicação (lembretes e WhatsApp), indicadores, relatórios e auditoria.

- **web/**: React + TypeScript + Vite + Tailwind (TanStack Query + Zustand), testado com Vitest + MSW
- **api/**: Laravel 12 + Sanctum (SPA) + Spatie Permission, testado com Pest
- **Banco:** MariaDB 11. Em dev, Docker só para o banco; em produção, a stack inteira em `deploy/`

## Requisitos

PHP ≥ 8.4 + Composer · Node ≥ 20 + npm · Docker.

## Instalação (dev)

```bash
# 1. Banco (MariaDB em 127.0.0.1:3312; cria ame_clinica e ame_test)
docker compose -p ame-clinica up -d

# 2. API
cd api
composer install
cp .env.example .env && php artisan key:generate
php artisan migrate --seed          # a clínica + admin de dev
php artisan serve                   # http://127.0.0.1:8000

# 3. Web (outro terminal)
cd web
npm install
npm run dev                         # http://localhost:5173 (proxy de /api e /sanctum)
```

Login de dev: `admin@clinica-exemplo.com.br` / `senha-de-dev-123`.

### Base de demonstração

Para o cliente ver o sistema "vivo", existe uma base com **12 meses de histórico 100%
fictício** (nomes sorteados de listas comuns, nenhum dado real, conforme a LGPD): 230
pacientes, 9 profissionais, ~12 mil agendamentos, pacotes, evoluções, financeiro com DRE,
convênios com ciclos fechados, lembretes, conversas de WhatsApp, mural e trilha de auditoria.

```bash
cd api
php artisan migrate:fresh           # APAGA a base local
php artisan demo:popular            # em produção: exige APP_DEMO=true e --senha=...
```

| E-mail | Nível |
|---|---|
| `admin@clinica-exemplo.com.br` | Administrador |
| `recepcao@…`, `recepcao2@clinica-exemplo.com.br` | Recepção |
| `financeiro@clinica-exemplo.com.br` | Financeiro |
| `mariana@…`, `juliana@…`, `camila@clinica-exemplo.com.br` | Profissional |

Sem `--senha`, todos usam `senha-de-dev-123`. O comando só roda em base sem pacientes. As
datas são ancoradas no dia em que ele roda. O WhatsApp aparece como "não conectado".

## Deploy

Veja **[`deploy/README.md`](deploy/README.md)**. Ele cobre a stack Docker isolada (`ame-app` +
`ame-db`), as variáveis de ambiente, o proxy com HTTPS para `ame.gestaonossa.com.br`, como
popular a demo e o backup.

## Variáveis de ambiente

- **Dev:** `api/.env.example`.
- **Produção:** `deploy/env.prod.example`. Destaques:
  - `APP_DEMO`: libera o `demo:popular` em produção.
  - `TRUSTED_PROXIES`: precisa ser env real do processo, não só do `.env`.
  - `SECURITY_HSTS`
  - `SECURITY_THROTTLE_PUBLICO_IP` / `SECURITY_THROTTLE_PUBLICO_LINK`: limites do cadastro on-line público.

Prontuário (evoluções, anamneses, observações) é cifrado com a `APP_KEY`: **backup do banco
sem a `APP_KEY` é ilegível**.

## Testes

```bash
cd api && php artisan test --parallel   # MariaDB ame_test (nunca SQLite); o container precisa estar de pé
cd web && npm test                      # Vitest
cd web && npx tsc -b && npm run lint    # typecheck + oxlint
```

## Estrutura

```
Ame-clinica/
├── api/                 ← Laravel 12 (app/, database/migrations, seeders, tests/)
│   └── database/seeders/Apresentacao/   ← a base de demonstração
├── web/                 ← React + Vite (src/paginas, componentes, servicos, hooks)
├── deploy/              ← Dockerfile, compose de produção, nginx, supervisord, guia
├── docker/              ← init do MariaDB de dev (bancos de teste e grants)
└── docker-compose.yml   ← banco de dev
```

## Como contribuir

- Branches `kebab-case` a partir de `main` (`feature/...`, `fix/...`).
- Conventional Commits no imperativo (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).
- Testes acompanham a feature, no padrão AAA. A suíte precisa estar verde antes do commit.
- Regra de negócio configurável é **dado** (tabelas `status_agendamento`, `configuracoes`),
  nunca if/else.
- Schema muda só por migration.
- Nunca dados reais de pacientes em seed, teste ou commit (LGPD: dados de menores).
- `.env` nunca vai para o git.

## Problemas conhecidos

- `routes/web.php` tem rota com Closure: **não use `route:cache`**.
- A tabela `whatsapp_conexoes` guarda uma conexão só, mas isso é garantido apenas pelo código
  (não há unique no banco).
