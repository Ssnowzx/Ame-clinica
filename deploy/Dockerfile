# Ame Clínica — single image: nginx + php-fpm + scheduler + queue worker under supervisord.
# Build context is the repository root:  docker compose -f deploy/docker-compose.prod.yml build

# --- 1. web (React + Vite) ---------------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# --- 2. api dependencies (composer) ------------------------------------------
FROM composer:2 AS vendor
WORKDIR /app
COPY api/composer.json api/composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --ignore-platform-reqs
COPY api/ ./
RUN composer dump-autoload --optimize --no-dev --classmap-authoritative --no-scripts

# --- 3. runtime ---------------------------------------------------------------
FROM php:8.4-fpm-bookworm
COPY --from=mlocati/php-extension-installer:2 /usr/bin/install-php-extensions /usr/local/bin/
RUN install-php-extensions pdo_mysql bcmath intl gd zip exif opcache sodium \
    && apt-get update \
    && apt-get install -y --no-install-recommends nginx supervisor mariadb-client \
    && rm -r /var/lib/apt/lists/*

COPY deploy/php.ini /usr/local/etc/php/conf.d/zz-ame.ini
COPY deploy/nginx.conf /etc/nginx/sites-available/default
COPY deploy/supervisord.conf /etc/supervisor/conf.d/ame.conf
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh

WORKDIR /var/www/api
COPY --from=vendor --chown=www-data:www-data /app /var/www/api
COPY --from=web /web/dist /var/www/web

RUN chmod 755 /usr/local/bin/entrypoint.sh \
    && php artisan package:discover --ansi \
    && mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && chown -R www-data:www-data storage bootstrap/cache

EXPOSE 80
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
