#!/usr/bin/env python3
"""Para/retoma somente serviços de um projeto isolado borala_cp3_*; preserva volumes."""
import json
import os
import subprocess
import time
from pathlib import Path

assert os.getenv('CP3_TESTE_ISOLADO') == 'true', 'Use CP3_TESTE_ISOLADO=true somente no ambiente isolado.'
assert os.getenv('COMPOSE_FILE'), 'Informe COMPOSE_FILE do projeto de teste.'
base = os.getenv('BASE_URL', 'http://localhost:23400')
resultados = {}
parados = set()

def executar(*args):
    return subprocess.check_output(args, text=True).strip()

def container(servico):
    id = executar('docker', 'compose', 'ps', '-q', servico)
    projeto = executar('docker', 'inspect', id, '--format', '{{index .Config.Labels "com.docker.compose.project"}}')
    assert projeto.startswith('borala_cp3_'), 'Este teste só pode parar containers de um projeto borala_cp3_*.'
    return id

containers = {s: container(s) for s in ('mongo', 'redis', 'elasticsearch')}

def aguardar(servico):
    limite = time.monotonic() + 120
    while time.monotonic() < limite:
        estado = executar('docker', 'inspect', containers[servico], '--format', '{{.State.Health.Status}}')
        if estado == 'healthy': return
        time.sleep(1)
    raise AssertionError('Serviço não se recuperou: ' + servico)

def requisitar(caminho, status=200):
    inicio = time.monotonic()
    raw = executar('curl', '-sS', '--max-time', '35', '-w', '\n%{http_code}', base + caminho)
    corpo, codigo = raw.rsplit('\n', 1)
    resposta = {'http': int(codigo), 'tempo_ms': round((time.monotonic()-inicio)*1000, 2), 'corpo': json.loads(corpo)}
    assert resposta['http'] == status, resposta
    return resposta

def parar(servico):
    parados.add(servico)
    executar('docker', 'stop', containers[servico])

def retomar(servico):
    executar('docker', 'start', containers[servico])
    aguardar(servico)
    parados.discard(servico)

try:
    disponiveis = requisitar('/api/corridas/disponiveis')['corpo']['dados']
    assert disponiveis, 'Use a base de teste inicial, com corridas disponíveis.'
    id = disponiveis[0]['_id']
    caminho = '/api/corridas/' + id
    busca = '/api/busca/corridas?q=UTFP&status=aguardando_motorista'
    executar('docker','compose','exec','-T','redis','redis-cli','DEL','borala:corrida:'+id)
    resultados['normal_miss'] = requisitar(caminho)
    resultados['normal_hit'] = requisitar(caminho)
    assert 'MISS' in resultados['normal_miss']['corpo']['origem_cache']
    assert 'HIT' in resultados['normal_hit']['corpo']['origem_cache']
    resultados['busca_normal'] = requisitar(busca)
    assert resultados['busca_normal']['corpo']['total'] >= 1

    parar('redis')
    resultados['redis_offline'] = requisitar(caminho)
    assert 'MONGODB' in resultados['redis_offline']['corpo']['origem_cache']
    assert resultados['redis_offline']['corpo']['aviso'] and resultados['redis_offline']['tempo_ms'] < 5000
    resultados['redis_geo_offline'] = requisitar('/api/motoristas/perto?longitude=-51.4628&latitude=-25.3907&raioKm=3', 503)
    resultados['geo_mongo_sem_redis'] = requisitar('/api/corridas/perto?longitude=-51.4628&latitude=-25.3907&raioKm=5')
    retomar('redis')
    executar('docker','compose','exec','-T','redis','redis-cli','DEL','borala:corrida:'+id)
    resultados['redis_recuperado_miss'] = requisitar(caminho)
    resultados['redis_recuperado_hit'] = requisitar(caminho)
    assert 'MISS' in resultados['redis_recuperado_miss']['corpo']['origem_cache']
    assert 'HIT' in resultados['redis_recuperado_hit']['corpo']['origem_cache']
    print('OK: Redis parado → Mongo 200 com aviso; retomada MISS/HIT sem reiniciar a API.', flush=True)

    parar('elasticsearch')
    resultados['elastic_offline'] = requisitar(busca, 503)
    assert 'erro' in resultados['elastic_offline']['corpo'] and resultados['elastic_offline']['tempo_ms'] < 15000
    retomar('elasticsearch')
    resultados['elastic_recuperado'] = requisitar(busca)
    assert resultados['elastic_recuperado']['corpo']['total'] >= 1
    print('OK: Elasticsearch parado → 503 claro; busca recuperada após start.', flush=True)

    executar('docker','compose','exec','-T','redis','redis-cli','DEL','borala:corrida:'+id)
    requisitar(caminho)
    parar('mongo')
    resultados['mongo_offline'] = requisitar('/api/corridas/disponiveis', 503)
    assert 'erro' in resultados['mongo_offline']['corpo'] and resultados['mongo_offline']['tempo_ms'] < 10000
    # Um HIT já presente não depende de uma consulta ao MongoDB.
    resultados['mongo_offline_cache_hit'] = requisitar(caminho)
    assert 'HIT' in resultados['mongo_offline_cache_hit']['corpo']['origem_cache']
    retomar('mongo')
    resultados['mongo_recuperado'] = requisitar('/api/corridas/disponiveis')
    print('OK: MongoDB parado → listagem 503; HIT existente preservado; listagem recuperada.', flush=True)
    resultados['health_final'] = requisitar('/api/health')
finally:
    for servico in list(parados):
        executar('docker', 'start', containers[servico])
        aguardar(servico)
    destino = Path(os.getenv('CP3_RESULTADOS_FALHAS', '/tmp/borala-cp3-falhas.json'))
    destino.write_text(json.dumps(resultados, ensure_ascii=False, indent=2))
    print('Resultados:', destino, flush=True)
