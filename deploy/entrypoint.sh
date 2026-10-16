#!/bin/sh
# Waits for the database, applies migrations and warms the config/view cache.
# route:cache is NOT used: routes/web.php has a Closure route, which is not serializable.
set -e
cd /var/www/api

until php -r 'new PDO("mysql:host=".getenv("DB_HOST").";port=".(getenv("DB_PORT")?:3306), getenv("DB_USERNAME"), getenv("DB_PASSWORD"));' 2>/dev/null; do
    echo "aguardando o banco..."
    sleep 2
done

php artisan migrate --force
php artisan storage:link 2>/dev/null || true
php artisan config:cache
php artisan view:cache
chown -R www-data:www-data storage bootstrap/cache

exec "$@"
