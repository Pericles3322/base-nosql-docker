#!/usr/bin/env python3
"""Testa localização em instância isolada, antes dos testes que aceitam as corridas."""
import json
import math
import os
import subprocess
from pathlib import Path
from urllib.parse import urlencode

assert os.getenv('CP3_TESTE_ISOLADO') == 'true'
assert os.getenv('COMPOSE_FILE')
base = os.getenv('BASE_URL', 'http://localhost:23400')
resultados = {}

def curl(path, method='GET', body=None, status=200):
    args = ['curl','--globoff','-sS','--max-time','20','-w','\n%{http_code}','-X',method,base+path]
    if body is not None: args += ['-H','Content-Type: application/json','-d',json.dumps(body)]
    raw = subprocess.check_output(args,text=True)
    texto, codigo = raw.rsplit('\n',1)
    assert int(codigo) == status, (path, codigo, texto)
    return json.loads(texto)

def mongo(js):
    raw = subprocess.check_output(['docker','compose','exec','-T','mongo','mongosh','-u','root','-p','root','--quiet','--eval',js],text=True)
    return json.loads(raw)

def distancia(coord):
    lon, lat = map(math.radians, coord)
    lon0, lat0 = map(math.radians, (-51.4628,-25.3907))
    a = math.sin((lat-lat0)/2)**2+math.cos(lat)*math.cos(lat0)*math.sin((lon-lon0)/2)**2
    return 6371 * 2 * math.asin(math.sqrt(a))

origens = mongo('print(JSON.stringify(db.getSiblingDB("borala").corridas.find({}, {origem:1}).toArray()))')
assert len(origens) == 8
assert all(c['origem']['localizacao']=={'type':'Point','coordinates':c['origem']['coordenadas']} for c in origens)
indices = mongo('print(JSON.stringify(db.getSiblingDB("borala").corridas.getIndexes()))')
assert any(i['name']=='idx_origem_geo' and i['key']=={'origem.localizacao':'2dsphere'} for i in indices)
resultados['documento_geo'] = origens[0]
resultados['indices_corridas'] = indices
for raio in (1,5):
    r = curl('/api/corridas/perto?'+urlencode(dict(longitude=-51.4628,latitude=-25.3907,raioKm=raio)))
    distancias = [distancia(c['origem']['localizacao']['coordinates']) for c in r['dados']]
    assert distancias == sorted(distancias) and all(d<=raio for d in distancias)
    assert all(c['status']=='aguardando_motorista' for c in r['dados'])
    resultados['raio_'+str(raio)] = r
    resultados['distancias_conferidas_'+str(raio)] = distancias
assert resultados['raio_1']['total']==1 and resultados['raio_5']['total']==2
assert {c['_id'] for c in resultados['raio_1']['dados']} <= {c['_id'] for c in resultados['raio_5']['dados']}
assert curl('/api/corridas/perto?longitude=0&latitude=0&raioKm=1')['total']==0
print('OK: GeoJSON, índice 2dsphere, raios 1/5 km, ordem e consulta vazia.',flush=True)

for rota in ('/api/corridas/perto','/api/motoristas/perto'):
    for query in ['', '?longitude=-51&latitude=200&raioKm=1','?longitude=-51&latitude=-25&raioKm=-1',
                  '?longitude=-51&latitude=-25&raioKm=31','?longitude=NaN&latitude=-25&raioKm=1',
                  '?longitude=&latitude=-25&raioKm=1','?longitude[]=-51&latitude=-25&raioKm=1',
                  '?longitude=181&latitude=-25&raioKm=1','?longitude=-51&latitude=-25&raioKm=Infinity']:
        curl(rota+query,status=400)
ids = mongo('print(JSON.stringify(db.getSiblingDB("borala").motoristas.find({}, {_id:1}).limit(2).toArray()))')
for motorista, coord in zip(ids, [(-51.4628,-25.3907),(-51.483,-25.389)]):
    r = curl('/api/motoristas/'+motorista['_id']+'/localizacao','POST',{'longitude':coord[0],'latitude':coord[1]})
    assert r['motorista_id']==motorista['_id']
resultados['redis_geo'] = curl('/api/motoristas/perto?longitude=-51.4628&latitude=-25.3907&raioKm=3')
r = resultados['redis_geo']
assert [x['motorista_id'] for x in r['dados']] == [x['_id'] for x in ids]
assert r['dados'][0]['distancia_km'] <= r['dados'][1]['distancia_km'] <= 3
# Uma nova posição atualiza o mesmo membro, em vez de criar outro motorista.
curl('/api/motoristas/'+ids[1]['_id']+'/localizacao','POST',{'longitude':-51.48,'latitude':-25.39})
assert curl('/api/motoristas/perto?longitude=-51.4628&latitude=-25.3907&raioKm=3')['total']==2
for body in [{}, {'longitude':'-51','latitude':-25}, {'longitude':-51,'latitude':90}, {'longitude':-181,'latitude':-25}]:
    curl('/api/motoristas/'+ids[0]['_id']+'/localizacao','POST',body,status=400)
curl('/api/motoristas/errado/localizacao','POST',{'longitude':0,'latitude':0},status=400)
# ID gerado no banco para testar ausência, não um ID de cadastro inventado.
id_ausente = mongo('print(JSON.stringify(new ObjectId().toString()))')
curl('/api/motoristas/'+id_ausente+'/localizacao','POST',{'longitude':0,'latitude':0},status=404)
curl('/api/desempenho/historico/invalido',status=400)
assert curl('/api/desempenho/historico/'+id_ausente)['total']==0
print('OK: Redis GEOADD/GEOSEARCH, atualização do membro, distâncias e validações 400/404.',flush=True)

raw = subprocess.check_output(['docker','compose','exec','-T','app','npm','run','seed:geo'],text=True)
resumo = json.loads(next(linha for linha in raw.splitlines() if linha.startswith('{')))
assert resumo['adaptadas']==0
# Campo já existente não deve ser sobrescrito na segunda execução.
assert origens == mongo('print(JSON.stringify(db.getSiblingDB("borala").corridas.find({}, {origem:1}).toArray()))')
resultados['segunda_execucao_seed_geo'] = resumo
Path(os.getenv('CP3_RESULTADOS_LOCALIZACAO','/tmp/borala-cp3-localizacao.json')).write_text(json.dumps(resultados,ensure_ascii=False,indent=2))
print('OK: segunda execução do seed adapta zero documentos e preserva localizações.',flush=True)
