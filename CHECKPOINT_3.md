# Bora Lá — Checkpoint 3

**Banco de Dados NoSQL — UTFPR Guarapuava, 2026/2**

Neste checkpoint, foram adicionadas a busca por localização, a escrita crítica com confirmação e a medição de desempenho. As funcionalidades dos Checkpoints 1 e 2 foram mantidas. Os resultados apresentados foram obtidos nos testes de 23/11/2026.

## Seção 1 — Localização

O local de embarque fica no MongoDB, junto da corrida. A posição do motorista, que pode mudar durante o uso do sistema, fica no Redis GEO.

### Corridas próximas

O script `seed-geo.ts` aproveita o campo `origem.coordenadas` que já existia e acrescenta o GeoJSON. Exemplo obtido na base de teste:

```json
{
  "_id": "6b04d8684d8844fa07270540",
  "origem": {
    "endereco": "Centro, Guarapuava - PR",
    "coordenadas": [-51.4628, -25.3907],
    "localizacao": {
      "type": "Point",
      "coordinates": [-51.4628, -25.3907]
    }
  }
}
```

A ordem é **[longitude, latitude]**. A longitude deve estar entre -180 e 180, e a latitude entre -90 e 90. O seed também cria o índice `idx_origem_geo`, do tipo `2dsphere`, em `origem.localizacao`.

Esse preparo é executado automaticamente pelo `./iniciar.sh`, antes da carga do Elasticsearch e da abertura da API. Ele só preenche localizações ausentes: na base antiga, adaptou oito corridas; na segunda execução, não alterou nenhuma.

A rota é `GET /api/corridas/perto?longitude=-51.4628&latitude=-25.3907&raioKm=1`. Ela usa `$near`, `$geometry` e `$maxDistance`, convertendo o raio de quilômetros para metros. Retorna até 20 corridas aguardando motorista e sem motorista associado, da mais próxima à mais distante. O raio permitido é maior que zero e de até 30 km.

| Raio testado | Resultado observado, na ordem |
|---|---|
| 1 km | 1 corrida: Centro |
| 5 km | 2 corridas: Centro e Bairro Santa Cruz |

O raio menor retornou um subconjunto do maior. Coordenadas inválidas, raio negativo ou acima do limite retornaram `400`. Uma busca sem corridas no raio retornou `200` com `total: 0`.

### Motoristas no Redis GEO

A chave usada é `borala:geo:motoristas`.

- `POST /api/motoristas/:id/localizacao`: verifica o motorista no MongoDB e usa `GEOADD` para guardar longitude e latitude.
- `GET /api/motoristas/perto`: usa `GEOSEARCH` com `FROMLONLAT`, `BYRADIUS`, `ASC` e `WITHDIST`, retornando IDs e distâncias em km.

No teste com dois motoristas, a busca de 3 km retornou distâncias de 0,0002 km e 2,0384 km, nessa ordem. Enviar outra posição para o mesmo motorista atualizou o membro, sem duplicá-lo.

O Redis aceita latitude até ±85.05112878. A posição representa o último envio do motorista, sem rastreamento contínuo ou expiração individual; por isso, ela pode ficar antiga e precisa ser atualizada pela rota.

## Seção 2 — Sistema com banco fora do ar

As falhas foram testadas com `docker stop` e a recuperação com `docker start`, em uma instalação isolada.

| Banco parado | Comportamento observado | Tempo da chamada |
|---|---|---:|
| Redis | Detalhe retornou `200`, com dados do MongoDB e aviso de cache indisponível | 30,15 ms |
| Elasticsearch | Busca retornou `503`, com mensagem de indisponibilidade | 3.558,69 ms |
| MongoDB | Listagem de corridas disponíveis retornou `503` | 5.020,83 ms |

Com Redis disponível, o detalhe continua usando o cache-aside: primeira leitura MISS e segunda HIT. Com ele parado, a API consulta o MongoDB e retorna `origem_cache: "MONGODB (CACHE MISS)"`, junto do aviso. Depois da retomada, o cache voltou a funcionar sem reiniciar a API. Foram mantidos o timeout e a fila offline desabilitada do cliente Redis.

Para a busca textual, foi escolhida a alternativa de `503` aceita na atividade:

```json
{ "erro": "Busca temporariamente indisponível: Elasticsearch fora do ar." }
```

A chamada de busca usa `requestTimeout: 2000` e `maxRetries: 0` para reduzir a espera quando o serviço cai. O tempo total também depende do tratamento da conexão.

No teste do MongoDB, foi usada `/api/corridas/disponiveis`, que consulta diretamente o banco. Um detalhe já armazenado no Redis ainda pode retornar HIT durante o TTL. Após retomar os três bancos e aguardar os health checks, a API voltou a responder normalmente, com health `OK`.

## Seção 3 — Escrita crítica

O aceite de corrida foi escolhido como escrita crítica, pois define qual motorista ficou responsável pelo atendimento.

| Não pode ser perdido — MongoDB | Pode atrasar, expirar ou ser refeito |
|---|---|
| Motorista, status e data do aceite | Cache da corrida no Redis |
| Cadastros e registro das corridas | Cópia de busca no Elasticsearch |
| Histórico de status e valores oficiais | Histórico recente de pesquisas no Redis |
| Origem e destino oficiais | Última posição informada pelo motorista no Redis GEO |

Na operação `findOneAndUpdate` da rota `PATCH /api/corridas/:id/aceitar`, foram usadas estas opções:

```typescript
{
  returnDocument: "after",
  writeConcern: { w: "majority", wtimeoutMS: 3000 }
}
```

O filtro atômico continua exigindo `status: "aguardando_motorista"` e `motorista_id: null`. Após a gravação confirmada, a API invalida o cache e atualiza o Elasticsearch. O primeiro aceite funcionou, e a segunda tentativa retornou `409`. No teste simultâneo, uma tentativa retornou `200` e a outra `409`.

O erro `MongoWriteConcernError` é tratado separadamente com `503` e um aviso de que a corrida pode ter sido atualizada. Um erro de confirmação não significa que a escrita não aconteceu. Por isso, a API não repete o aceite automaticamente, e o estado deve ser conferido diretamente no MongoDB antes de tentar novamente.

O projeto usa MongoDB standalone. Portanto, esse teste não demonstra confirmação em várias réplicas. O erro de confirmação não foi provocado no banco durante os testes; seu tratamento foi conferido no código.

## Seção 4 — Desempenho

### Carga e consulta

O comando `npm run seed:carga` criou **30.000 documentos** em `corridas_carga`, em lotes de 1.000. São 100 passageiros sintéticos, com 300 corridas para cada um e datas distintas. Se a coleção já tiver dados, o seed informa a quantidade e não insere tudo novamente.

A coleção é auxiliar: seus dados não são enviados ao Elasticsearch nem aparecem nas rotas das corridas reais. A consulta representa o histórico das dez corridas mais recentes de um passageiro:

```typescript
getCollection("corridas_carga")
  .find({ passageiro_id: new ObjectId(passageiroId) })
  .sort({ data_solicitacao: -1 })
  .limit(10)
  .toArray();
```

A rota medida foi `GET /api/desempenho/historico/:passageiroId`, sem Redis. O passageiro usado foi `000000000000000000000001`, gerado pelo seed. O script de índice e o benchmark selecionam esse passageiro automaticamente quando nenhum ID é informado.

### Explain antes e depois

A mesma consulta foi executada com `explain("executionStats")`, primeiro sem o índice composto e depois com ele:

| Medição | Sem índice composto | Com índice composto |
|---|---|---|
| Plano | COLLSCAN → SORT | IXSCAN → FETCH → LIMIT |
| Documentos examinados | 30.000 | 10 |
| Chaves examinadas | 0 | 10 |
| Documentos retornados | 10 | 10 |
| Tempo de execução | 30 ms | 1 ms |

O índice criado foi `{ passageiro_id: 1, data_solicitacao: -1 }`. O passageiro vem primeiro por ser o filtro de igualdade; a data vem em seguida para atender à ordenação. Com isso, o banco consegue obter as dez corridas sem percorrer toda a coleção e ordenar o resultado.

### Benchmark

O `npm run benchmark` usa `fetch` e `performance.now()` do Node. Foram feitas 1.000 requisições, com dez simultâneas, em cada fase. O p95 foi calculado a partir das latências ordenadas, incluindo a leitura do corpo das respostas.

| Medição | Sem índice composto | Com índice composto |
|---|---:|---:|
| Requisições / simultâneas | 1.000 / 10 | 1.000 / 10 |
| Respostas 2xx | 1.000 | 1.000 |
| Erros | 0 | 0 |
| Duração total | 13.312,50 ms | 1.843,92 ms |
| Vazão | 75,12 req/s | 542,32 req/s |
| p95 | 240,78 ms | 29,24 ms |

As medições foram feitas em containers locais, com o mesmo passageiro e a mesma carga nas duas fases, sem aquecimento separado. Os tempos podem variar entre execuções. A redução dos documentos examinados mostra o efeito do índice de forma mais estável.

O `getIndexes()` ao final mostrou:

| Índice | Campos | Motivo |
|---|---|---|
| `_id_` | `{ _id: 1 }` | Identificação dos documentos |
| `idx_passageiro_data` | `{ passageiro_id: 1, data_solicitacao: -1 }` | Filtro e ordenação do histórico |

O índice composto ficou criado ao final. Ele melhora essa leitura, mas ocupa espaço e aumenta o trabalho de manutenção nas escritas. Nenhum índice das coleções reais foi removido.

## Seção 5 — Roteiro de demonstração

O início exige Docker e Docker Compose. O roteiro também usa `curl`, Bash e Python 3 para obter os IDs. As respostas abaixo são as **esperadas**; os resultados efetivamente medidos estão nas seções anteriores. Como o aceite altera uma corrida, use uma instância de apresentação com os dados iniciais.

### 1. Iniciar e verificar o GeoJSON

```bash
git clone https://github.com/Pericles3322/base-nosql-docker.git
cd base-nosql-docker
./iniciar.sh
export API=http://localhost:3400
curl -fsS "$API/api/health"
# Esperado: bancos ONLINE e status_geral OK.

docker compose exec -T mongo mongosh -u root -p root --quiet \
  --eval 'const b=db.getSiblingDB("borala"); printjson(b.corridas.findOne({}, {origem:1})); printjson(b.corridas.getIndexes())'
# Esperado: origem.localizacao com Point e índice idx_origem_geo/2dsphere.
```

Na máquina dos testes, foi necessário usar `BORALA_BUILD_NETWORK=host ./iniciar.sh` por uma falha de acesso ao npm pela bridge padrão do Docker. Essa opção altera apenas a rede do build.

### 2. Buscar por raio

```bash
curl -fsS "$API/api/corridas/perto?longitude=-51.4628&latitude=-25.3907&raioKm=1"
# Esperado: total 1, Centro.
curl -fsS "$API/api/corridas/perto?longitude=-51.4628&latitude=-25.3907&raioKm=5"
# Esperado: total 2, Centro antes de Bairro Santa Cruz.
```

### 3. Informar a posição dos motoristas

```bash
export MOTORISTA_ID=$(docker compose exec -T mongo mongosh -u root -p root --quiet \
  --eval 'print(db.getSiblingDB("borala").motoristas.findOne({disponivel:true})._id.toString())')
export MOTORISTA_2_ID=$(docker compose exec -T mongo mongosh -u root -p root --quiet \
  --eval "print(db.getSiblingDB('borala').motoristas.findOne({_id:{\$ne:ObjectId('$MOTORISTA_ID')}})._id.toString())")
# Esperado: dois IDs diferentes de motoristas existentes.

curl -fsS -X POST "$API/api/motoristas/$MOTORISTA_ID/localizacao" \
  -H 'Content-Type: application/json' -d '{"longitude":-51.4628,"latitude":-25.3907}'
curl -fsS -X POST "$API/api/motoristas/$MOTORISTA_2_ID/localizacao" \
  -H 'Content-Type: application/json' -d '{"longitude":-51.483,"latitude":-25.389}'
# Esperado nos dois POSTs: localização temporária atualizada.
curl -fsS "$API/api/motoristas/perto?longitude=-51.4628&latitude=-25.3907&raioKm=3"
# Esperado: dois motoristas, ordenados pela distância em km.
```

### 4. Conferir cache e busca textual

```bash
export CORRIDA_ID=$(curl -fsS "$API/api/corridas/disponiveis" | python3 -c \
 'import json,sys; print(json.load(sys.stdin)["dados"][0]["_id"])')
# Esperado: ID de uma corrida disponível.
docker compose exec -T redis redis-cli DEL "borala:corrida:$CORRIDA_ID"
# Esperado: 0 ou 1; remove apenas essa chave de cache.
curl -fsS "$API/api/corridas/$CORRIDA_ID"
# Esperado: MONGODB (CACHE MISS).
curl -fsS "$API/api/corridas/$CORRIDA_ID"
# Esperado: REDIS (CACHE HIT), com os mesmos dados.
curl -fsS "$API/api/busca/corridas?q=UTFP&status=aguardando_motorista"
# Esperado: encontra a corrida com destino UTFPR Guarapuava.
```

### 5. Testar a queda e a retomada dos bancos

```bash
export REDIS_CONTAINER=$(docker compose ps -q redis)
export ES_CONTAINER=$(docker compose ps -q elasticsearch)
export MONGO_CONTAINER=$(docker compose ps -q mongo)
# Esperado: IDs dos serviços desta instalação.

aguardar_saude() {
  for tentativa in {1..120}; do
    if [ "$(docker inspect --format '{{.State.Health.Status}}' "$1")" = healthy ]; then return 0; fi
    sleep 1
  done
  echo "Serviço não ficou pronto: $1" >&2
  return 1
}
trap 'docker start "$REDIS_CONTAINER" "$ES_CONTAINER" "$MONGO_CONTAINER" >/dev/null' EXIT

docker stop "$REDIS_CONTAINER"
curl -i "$API/api/corridas/$CORRIDA_ID"
# Esperado: Redis parado e detalhe com HTTP 200, origem MongoDB e aviso.
docker start "$REDIS_CONTAINER"
aguardar_saude "$REDIS_CONTAINER"
# Esperado: Redis healthy.

docker stop "$ES_CONTAINER"
curl -i "$API/api/busca/corridas?q=UTFP&status=aguardando_motorista"
# Esperado: Elasticsearch parado e busca com HTTP 503 claro.
docker start "$ES_CONTAINER"
aguardar_saude "$ES_CONTAINER"
curl -fsS "$API/api/busca/corridas?q=UTFP&status=aguardando_motorista"
# Esperado: busca funcionando novamente.

docker stop "$MONGO_CONTAINER"
curl -i "$API/api/corridas/disponiveis"
# Esperado: MongoDB parado e listagem com HTTP 503.
docker start "$MONGO_CONTAINER"
aguardar_saude "$MONGO_CONTAINER"
curl -fsS "$API/api/corridas/disponiveis"
# Esperado: listagem funcionando novamente.
trap - EXIT
```

### 6. Demonstrar a escrita crítica

```bash
curl -fsS -X PATCH "$API/api/corridas/$CORRIDA_ID/aceitar" \
  -H 'Content-Type: application/json' -d "{\"motorista_id\":\"$MOTORISTA_ID\"}"
# Esperado: HTTP 200, corrida aceita e sincronização concluída.
curl -sS -w '\nHTTP %{http_code}\n' -X PATCH "$API/api/corridas/$CORRIDA_ID/aceitar" \
  -H 'Content-Type: application/json' -d "{\"motorista_id\":\"$MOTORISTA_ID\"}"
# Esperado: HTTP 409, impedindo outro aceite.
curl -fsS "$API/api/corridas/$CORRIDA_ID"
# Esperado: MISS com motorista e status atualizados.
```

### 7. Comparar o desempenho

```bash
docker compose exec -T app npm run seed:carga
# Esperado: 30000 documentos; se já existirem, seed_pulado sem duplicação.
export PASSAGEIRO_TESTE_ID=$(docker compose exec -T mongo mongosh -u root -p root --quiet \
  --eval 'print(db.getSiblingDB("borala").corridas_carga.findOne().passageiro_id.toString())')
# Esperado: ID de passageiro da coleção auxiliar.

docker compose exec -T -e PASSAGEIRO_TESTE_ID="$PASSAGEIRO_TESTE_ID" app npm run indice:carga -- remover
# Esperado: _id_ permanece; explain com COLLSCAN/SORT e 30000 documentos examinados.
docker compose exec -T -e PASSAGEIRO_TESTE_ID="$PASSAGEIRO_TESTE_ID" app npm run benchmark
# Esperado: 1000 requisições, 10 simultâneas, vazão e p95 sem índice.

docker compose exec -T -e PASSAGEIRO_TESTE_ID="$PASSAGEIRO_TESTE_ID" app npm run indice:carga -- criar
# Esperado: índice composto criado; explain com IXSCAN e 10 documentos examinados.
docker compose exec -T -e PASSAGEIRO_TESTE_ID="$PASSAGEIRO_TESTE_ID" app npm run benchmark
# Esperado: mesma quantidade e concorrência, vazão e p95 com índice.
docker compose exec -T mongo mongosh -u root -p root --quiet \
  --eval 'printjson(db.getSiblingDB("borala").corridas_carga.getIndexes())'
# Esperado: _id_ e idx_passageiro_data; índice composto mantido ao final.
```

### 8. Conferir o estado final

```bash
docker compose ps
curl -fsS "$API/api/health"
# Esperado: serviços ligados e health OK.
curl -fsS "$API/api/corridas/filtro?status=finalizada&valorMin=10&valorMax=30"
# Esperado: consulta do Checkpoint 1 funcionando.
curl -fsS "$API/api/sincronizacao/pendentes"
# Esperado: quantidade 0 após as operações sincronizadas.
```

Também passaram o build TypeScript, as verificações dos scripts e do Compose e os 28 testes de regressão dos Checkpoints 1 e 2. A validação foi feita em ambientes isolados, e a migração também foi conferida na base existente, preservando os dados anteriores.

Para repetir a validação completa em outro ambiente isolado, use `./scripts/validar-checkpoint-3.sh` (com `BORALA_BUILD_NETWORK=host` se necessário). Ele guarda os resultados em uma pasta temporária e para somente os containers de teste ao terminar, mantendo seus volumes.
