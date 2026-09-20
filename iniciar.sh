#!/usr/bin/env bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APP_PORTS=(3400 8400 8401 8402 27034 6334 9234)

echo "Verificando portas utilizadas pelo projeto..."

for port in "${APP_PORTS[@]}"; do
    if command -v fuser >/dev/null 2>&1; then
        fuser -k -n tcp "$port" >/dev/null 2>&1 || true
    fi
done

echo "Iniciando ambiente do Bora Lá..."

if docker info >/dev/null 2>&1; then
    docker compose up -d --build --remove-orphans
elif sg docker -c "docker info" >/dev/null 2>&1; then
    sg docker -c "docker compose up -d --build --remove-orphans"
else
    sudo docker compose up -d --build --remove-orphans
fi

if [[ -f "$SCRIPT_DIR/init/redis-init.commands" ]]; then
    echo "Carregando dados iniciais do Redis..."

    for i in {1..10}; do
        if docker exec nosql_redis redis-cli ping >/dev/null 2>&1; then
            docker exec -i nosql_redis redis-cli < "$SCRIPT_DIR/init/redis-init.commands" >/dev/null 2>&1 || true
            break
        fi

        sleep 1
    done
fi

echo ""
echo "Bora Lá iniciado com sucesso."
echo "API:            http://localhost:3400"
echo "Health Check:   http://localhost:3400/api/health"
echo "Corridas:       http://localhost:3400/api/corridas/disponiveis"
echo "Mongo Express:  http://localhost:8401"
echo "Redis Commander:http://localhost:8402"
echo "ElasticVue:     http://localhost:8400"
echo ""
