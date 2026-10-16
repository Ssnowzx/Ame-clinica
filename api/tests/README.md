# Testes — como rodar e o contrato de isolamento

Os testes de API rodam contra **MariaDB** (nunca SQLite — design D6), no banco
`ame_test` do container `ame-clinica-db` (`docker-compose.yml` na raiz). Quatro
suítes: `Unit`, `Feature`, `Arquitetura`, `Concorrencia`.

## Comandos

| Comando | O que faz | Quando usar |
|---|---|---|
| `composer test` | `php artisan test --parallel` — **um banco por worker** | Padrão. Roda a suíte inteira, isolada e rápida. |
| `composer test:seq` | `php artisan test` (sequencial, banco único) | Debug de **um** teste: `php artisan test --filter=Nome`. |

Sob `--parallel` (ParaTest, já instalado), cada worker recebe seu próprio banco —
`ame_test`, `ame_test_test_1`, `ame_test_test_2`, … — criado e migrado
isoladamente. É isso que fecha o gatilho **TEST-DB**: dois workers da MESMA execução
nunca dividem schema, então some a contenção (os deadlocks 1213 e o
`Table 'ame_test.clinica' doesn't exist` que apareciam quando duas execuções
colidiam no mesmo banco).

### A suíte `Concorrencia` sob paralelo

A `Concorrencia` prova LOCK com uma **segunda conexão** de verdade
(`GuardaClinicaSobLockTest.php` → `segundaConexao()`). Ela clona
`config('database.connections.mysql')`, que o Laravel **já reescreve para o banco
do worker** (`ame_test_test_N`) antes do corpo do teste. Ou seja: a segunda conexão
enxerga os dados commitados no banco DO PRÓPRIO worker — a prova continua válida sob
`--parallel`, sem nome de banco hardcoded. **Não** fixe o nome do banco nessa conexão;
deixe-a ler da config.

## Pré-requisito de infra: o grant escopado

Criar/dropar os bancos `ame_test_test_N` exige que o usuário de teste (`ame`) tenha
privilégio de nível de schema **restrito ao padrão `ame_test%`**. O
`docker/mariadb/init/02-test-grants.sql` concede isso em setup novo:

```sql
GRANT ALL PRIVILEGES ON `ame\_test%`.* TO 'ame'@'%';
```

O `_` é **escapado** (`\_`) para casar o underscore literal: o padrão pega
`ame_test`, `ame_test_test_1`, … e **nunca** `ame_clinica` (o banco de
produção/demo). Jamais use `ON *.*` — a trava de segurança é o ESCOPO.

Num banco **já existente** (o volume não re-roda o `init/`), aplique via root:

```bash
docker exec -i ame-clinica-db mariadb -uroot -p"$DB_ROOT_PASSWORD" \
  < docker/mariadb/init/02-test-grants.sql
```

## O que o `--parallel` NÃO resolve: duas INVOCAÇÕES concorrentes

`--parallel` isola **dentro de uma única invocação** de `php artisan test`. Ele
**não** isola dois runners SEPARADOS rodando ao mesmo tempo — porque ambos usariam os
mesmos nomes `ame_test_test_1..N` e voltariam a colidir. Exemplos: o CI paralelo e um
`composer test` local ao mesmo tempo; um agente rodando a suíte enquanto um dev roda a
dele.

**Contrato:** cada runner SEPARADO que possa rodar em paralelo com outro exporta um
`DB_DATABASE` distinto. Ex.: no CI, `DB_DATABASE=ame_ci` — o `--parallel` então cria
`ame_ci_test_N`, sem tocar os `ame_test_test_N` do dev. (O grant `ame\_test%` **não**
cobre `ame_ci%`; um runner com prefixo próprio precisa do seu próprio grant escopado,
no mesmo molde.)

Com o isolamento por processo no lugar, a antiga ordem aos agentes — "não rode a suíte
em paralelo comigo" — deixa de ser a ÚNICA defesa contra a contenção intra-execução.
Ela segue valendo só para não competir por recursos da máquina, não mais para não
corromper o banco.
