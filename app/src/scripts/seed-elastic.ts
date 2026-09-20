import fs from "fs";
import path from "path";
import {
  connectMongo,
  getCollection,
  closeMongo
} from "../database/mongo.js";
import {
  connectElastic,
  getElasticClient,
  closeElastic
} from "../database/elastic.js";

function carregarConfiguracao() {
  const caminhos = [
    path.resolve(process.cwd(), "init", "elastic-init.json"),
    path.resolve(process.cwd(), "..", "init", "elastic-init.json"),
    path.resolve("/app", "init", "elastic-init.json")
  ];

  for (const caminho of caminhos) {
    if (fs.existsSync(caminho)) {
      return JSON.parse(fs.readFileSync(caminho, "utf-8"));
    }
  }

  throw new Error("Arquivo init/elastic-init.json não encontrado.");
}

async function seedElasticsearch() {
  await connectMongo();
  await connectElastic();

  const elastic = getElasticClient();
  const configuracao = carregarConfiguracao();
  const indice = "corridas";

  const existe = await elastic.indices.exists({ index: indice });

  if (existe) {
    await elastic.indices.delete({ index: indice });
  }

  await elastic.indices.create({
    index: indice,
    settings: configuracao.settings,
    mappings: configuracao.mappings
  });

  const corridas = await getCollection("corridas").find().toArray();

  for (const corrida of corridas) {
    await elastic.index({
      index: indice,
      id: corrida._id.toString(),
      document: {
        corrida_id: corrida._id.toString(),
        passageiro_id: corrida.passageiro_id?.toString() || null,
        motorista_id: corrida.motorista_id?.toString() || null,
        origem: corrida.origem?.endereco,
        destino: corrida.destino?.endereco,
        status: corrida.status,
        valor_estimado: corrida.valor_estimado,
        distancia_estimada_km: corrida.distancia_estimada_km,
        data_solicitacao: corrida.data_solicitacao
      }
    });
  }

  await elastic.indices.refresh({ index: indice });

  console.log(`${corridas.length} corridas enviadas para o Elasticsearch.`);

  await closeMongo();
  await closeElastic();
}

seedElasticsearch().catch((erro) => {
  console.error("Erro ao sincronizar Elasticsearch:", erro);
  process.exit(1);
});
