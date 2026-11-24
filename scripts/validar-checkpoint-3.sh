#!/usr/bin/env bash
# Cria um projeto Compose novo: não monta volumes da instalação pessoal.
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"
TESTE_DIR="$(mktemp -d /tmp/borala-cp3-XXXXXX)"
docker compose config --format json > "$TESTE_DIR/original.json"
python3 - "$TESTE_DIR" "$RAIZ" <<'PY'
import json, pathlib, shutil, sys
p=pathlib.Path(sys.argv[1]); raiz=pathlib.Path(sys.argv[2])
c=json.loads((p/'original.json').read_text())
c['name']='borala_cp3_'+p.name.rsplit('-',1)[-1].lower()
for name, service in c['services'].items():
    service.pop('container_name',None)
    for port in service.get('ports',[]):
        port['published']=str(int(port['published'])+20000)
    if name=='app':
        service['environment'].update(NODE_ENV='development',PERMITIR_SIMULACAO_FALHA='true')
# compose config materializa nomes: sobrescrever TODOS, não só o nome do projeto.
for kind in ('volumes','networks'):
    for key,value in c.get(kind,{}).items():
        assert not value.get('external'), 'Não usar volumes/redes externos no teste'
        value['name']=c['name']+'_'+key
(p/'docker-compose.yaml').write_text(json.dumps(c,indent=2))
shutil.copy2(raiz/'iniciar.sh',p/'iniciar.sh')
PY
export COMPOSE_FILE="$TESTE_DIR/docker-compose.yaml"
echo "Configuração isolada: $COMPOSE_FILE (API 23400, ES 29234)"
# Encerra apenas os containers deste projeto ao sair; mantém todos os volumes.
trap 'docker compose stop' EXIT
(cd "$TESTE_DIR" && ./iniciar.sh)
export BASE_URL=http://localhost:23400
export ELASTIC_URL=http://localhost:29234
export CP3_TESTE_ISOLADO=true
CP3_RESULTADOS_LOCALIZACAO="$TESTE_DIR/localizacao.json" python3 "$RAIZ/scripts/test-localizacao-checkpoint-3.py"
CP3_RESULTADOS_FALHAS="$TESTE_DIR/falhas.json" python3 "$RAIZ/scripts/test-falhas-checkpoint-3.py"
CP3_MEDICOES_DIR="$TESTE_DIR/medicoes" python3 "$RAIZ/scripts/medir-checkpoint-3.py"
CP2_PERMITIR_ESCRITAS_TESTE=true CP2_RESULTADOS="$TESTE_DIR/regressao-cp2.json" \
    python3 "$RAIZ/scripts/test-checkpoint-2.py"
docker compose exec -T app node -e 'fetch("http://localhost:3400/api/health").then(async r => { console.log(await r.text()); if(r.status !== 200) process.exit(1); }).catch(() => process.exit(1))'
echo "Evidências de localização, falhas, medições e regressão: $TESTE_DIR"
