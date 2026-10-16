# Ame Clínica — api/

API da Ame Clínica (Laravel 12 + Sanctum SPA + Spatie Permission + MariaDB). Clínica única: não há multi-tenant.
**Setup completo, login de dev e regras do projeto: ver o [`README.md` da raiz](../README.md).**

```bash
# banco de pé (docker compose up -d na raiz) e .env criado a partir do .env.example
php artisan migrate --seed   # clínica "Clínica Exemplo" + admin de dev
php artisan serve            # http://127.0.0.1:8000
php artisan test             # Pest contra o MariaDB ame_test (nunca SQLite)
```

Segurança (obrigatório): `APP_DEBUG=true` **somente** em dev local; `.env` nunca vai para o
git; o banco escuta só em loopback; recomenda-se disco criptografado (FileVault) na máquina
que roda o banco — a base terá dados de menores (LGPD, §12/§16 da especificação).

**Criptografia do prontuário (etapa 6):** `evolucoes.conteudo`, `anamneses.respostas_json` e
`atendimentos.observacoes` são cifrados em repouso com a `APP_KEY` (casts `encrypted`).
Consequências operacionais:

- **Backup do banco SEM backup seguro da `APP_KEY` é backup inútil** — o dump é ilegível sem a
  key. Guarde a key em cofre separado do dump; isso integra o débito de go-live de
  backup/restore (parecer security-atendimento-evolucao).
- Rotacionar a `APP_KEY` exige **re-cifrar** os campos clínicos (não há rotação transparente).
