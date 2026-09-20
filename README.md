# Bora Lá

Projeto da disciplina de **Banco de Dados NoSQL** da UTFPR.

O Bora Lá é um sistema simples de corridas. O passageiro pode solicitar uma corrida informando origem e destino e um motorista cadastrado pode aceitar a solicitação.

## Tecnologias

- MongoDB
- Node.js
- TypeScript
- Express
- Docker
- Redis
- Elasticsearch

## Banco principal

O banco utilizado pelo projeto é:

```text
borala
```

Coleções principais:

```text
passageiros
motoristas
corridas
avaliacoes
```

## Iniciar o projeto

Dê permissão aos scripts caso seja necessário:

```bash
chmod +x iniciar.sh parar.sh reset.sh
```

Inicie o ambiente:

```bash
./iniciar.sh
```

## Endereços

| Serviço | Endereço |
|---|---|
| API | http://localhost:3400 |
| Health Check | http://localhost:3400/api/health |
| Mongo Express | http://localhost:8401 |
| Redis Commander | http://localhost:8402 |
| ElasticVue | http://localhost:8400 |

## Consultas do Checkpoint 1

### Corridas disponíveis

```http
GET /api/corridas/disponiveis
```

### Histórico do passageiro

```http
GET /api/corridas/passageiro/:id
```

### Histórico do motorista

```http
GET /api/corridas/motorista/:id
```

### Filtro por status e valor

Exemplo:

```http
GET /api/corridas/filtro?status=finalizada&valorMin=10&valorMax=30
```

### Aceitar corrida

```http
PATCH /api/corridas/:id/aceitar
```

Corpo da requisição:

```json
{
  "motorista_id": "ID_DO_MOTORISTA"
}
```

## Recriar o banco

Para apagar os volumes locais e executar novamente os dados do `init/mongo-init.js`:

```bash
./reset.sh
```

## Documentação do Checkpoint

A documentação da atividade está no arquivo:

```text
CHECKPOINT_1.md
```
