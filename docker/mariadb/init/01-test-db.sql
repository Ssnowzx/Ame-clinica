-- Database de TESTE (testes de API rodam contra MariaDB, nunca SQLite — design D6).
-- Roda apenas na primeira inicialização do volume.
CREATE DATABASE IF NOT EXISTS ame_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON ame_test.* TO 'ame'@'%';
FLUSH PRIVILEGES;
