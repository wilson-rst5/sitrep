#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
password=$(openssl rand -hex 32)
token=$(openssl rand -hex 32)
set -C
sed -e "s/^POSTGRES_PASSWORD=$/POSTGRES_PASSWORD=$password/" \
    -e "s/^SETUP_TOKEN=$/SETUP_TOKEN=$token/" .env.example > .env
printf '%s\n' 'Created .env with a unique database password and administrator bootstrap token.'
