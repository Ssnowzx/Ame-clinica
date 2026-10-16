# Deploy — Ame Clínica (demo em `ame.gestaonossa.com.br`)

Uma stack Docker própria e **isolada**: project `ame`, containers `ame-app` e `ame-db`, rede
`ame_net` (172.31.90.0/24), volumes `ame_db_data` e `ame_storage`, porta só em loopback
(`127.0.0.1:8090`). Ela não compartilha nada com outra stack da mesma VPS. **Não rode nenhum
comando `docker compose` desta pasta apontando para o diretório de outro sistema, nem o
contrário.**

```
ame-app  = nginx (SPA + /api) + php-fpm + scheduler + fila, sob supervisord
ame-db   = MariaDB 11
```

## 1. Primeira vez

```bash
# na VPS
git clone git@github.com:Ssnowzx/Ame-clinica.git /opt/ame
cd /opt/ame
cp deploy/env.prod.example deploy/.env
# preencha APP_KEY, DB_PASSWORD e DB_ROOT_PASSWORD (gere com o comando abaixo)
php -r 'echo "base64:".base64_encode(random_bytes(32)), PHP_EOL;'   # APP_KEY (ou: openssl rand -base64 32)
openssl rand -hex 24                                              # senhas do banco

docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
docker logs -f ame-app        # espere "aguardando o banco..." sumir e as migrations rodarem
```

Confira se a porta `8090` está livre antes (`ss -ltn | grep 8090`); se não estiver, mude
`APP_PORT` no `deploy/.env`. Se a faixa `172.31.90.0/24` já for usada por outra rede Docker
(`docker network inspect $(docker network ls -q) | grep Subnet`), troque-a no compose **e** em
`TRUSTED_PROXIES`.

## 2. Popular com a demonstração (dados fictícios)

```bash
docker exec ame-app php artisan demo:popular --senha='ESCOLHA-UMA-SENHA-FORTE'
```

Leva alguns segundos e cria a "Ame Clínica" com 12 meses de histórico, entre agenda,
pacientes, financeiro, convênios, mensagens e auditoria. Todos os nomes são inventados. A
senha informada vale para **todos** os usuários da demo:

| E-mail | Nível |
|---|---|
| `admin@clinica-exemplo.com.br` | Administrador |
| `recepcao@clinica-exemplo.com.br`, `recepcao2@clinica-exemplo.com.br` | Recepção |
| `financeiro@clinica-exemplo.com.br` | Financeiro |
| `<primeiro-nome>@clinica-exemplo.com.br` (veja Administração → Usuários) | Profissional |

O comando só roda com `APP_DEMO=true` e em base **sem pacientes**. As datas são ancoradas no
dia em que ele roda. Para renovar a demo (por exemplo, na véspera de uma apresentação):

```bash
docker exec ame-app php artisan migrate:fresh --force      # APAGA a base inteira
docker exec ame-app php artisan demo:popular --senha='...'
```

> Quando a clínica passar a usar o sistema de verdade, coloque `APP_DEMO=false` no
> `deploy/.env` e recrie o container. A partir daí, nem o `demo:popular` nem um
> `migrate:fresh` devem ser rodados.

## 3. Proxy da frente e HTTPS

O DNS `ame.gestaonossa.com.br` precisa apontar para a VPS (registro A). O proxy que já
atende a VPS encaminha para `127.0.0.1:8090`.

**nginx:**

```nginx
server {
    server_name ame.gestaonossa.com.br;
    client_max_body_size 25M;
    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        add_header Strict-Transport-Security "max-age=31536000" always;
    }
}
```

**Apache** (`a2enmod proxy proxy_http headers`):

```apache
<VirtualHost *:80>
    ServerName ame.gestaonossa.com.br
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:8090/
    ProxyPassReverse / http://127.0.0.1:8090/
    RequestHeader set X-Forwarded-Proto "https" env=HTTPS
</VirtualHost>
```

Depois: `certbot --nginx -d ame.gestaonossa.com.br` (ou `--apache`).

## 4. Atualizar

```bash
# na máquina local: git push origin main   (o deploy só leva o que está no GitHub)
cd /opt/ame && git pull --ff-only
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```

O `entrypoint.sh` roda `migrate --force`, `config:cache` e `view:cache` a cada subida. **Não
rode `route:cache`**: `routes/web.php` tem uma rota com Closure, e o cache de rotas derruba o
app.

## 5. Conferir

```bash
curl -sI https://ame.gestaonossa.com.br/up                 # 200
docker exec ame-app php artisan tinker --execute="var_dump(env('TRUSTED_PROXIES'));"
docker exec ame-app php artisan queue:monitor database:default --max=50
```

## Backup

Guarde a `APP_KEY` do `deploy/.env` num cofre, separada do dump. O prontuário é cifrado com
ela, e sem a chave o backup não pode ser lido.

```bash
docker exec ame-db sh -c 'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction "$MARIADB_DATABASE"' | gzip > ame-$(date +%F).sql.gz
```
