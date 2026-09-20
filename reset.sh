#!/usr/bin/env bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Esta ação apagará os dados locais e recriará o banco Bora Lá."
read -p "Deseja continuar? (s/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Ss]$ ]]; then
    echo "Operação cancelada."
    exit 0
fi

echo "Removendo containers e volumes..."

if docker info >/dev/null 2>&1; then
    docker compose down -v
    docker compose up -d --build
elif sg docker -c "docker info" >/dev/null 2>&1; then
    sg docker -c "docker compose down -v && docker compose up -d --build"
else
    sudo docker compose down -v
    sudo docker compose up -d --build
fi

echo "Ambiente recriado com sucesso."
echo "O banco 'borala' será preenchido novamente pelo init/mongo-init.js."
