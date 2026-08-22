#!/bin/bash
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE USER keycloak WITH PASSWORD '${DB_PASSWORD}';
    CREATE DATABASE keycloak OWNER keycloak;
    CREATE USER platform WITH PASSWORD '${DB_PASSWORD}';
    CREATE DATABASE platform OWNER platform;
EOSQL
