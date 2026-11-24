import { connectMongo, getCollection, closeMongo } from "../database/mongo.js";
import { coordenadasValidas } from "../services/localizacao.js";

async function prepararLocalizacao() {
  await connectMongo();
  const corridas = getCollection("corridas");
  let adaptadas = 0;
  let ignoradas = 0;
  const cursor = corridas.find({ "origem.localizacao": { $exists: false } });
  for await (const corrida of cursor) {
    const coordenadas = corrida.origem?.coordenadas;
    if (!Array.isArray(coordenadas) || coordenadas.length !== 2 || !coordenadasValidas(coordenadas[0], coordenadas[1])) {
      ignoradas++;
      continue;
    }
    const resultado = await corridas.updateOne(
      { _id: corrida._id, "origem.localizacao": { $exists: false } },
      { $set: { "origem.localizacao": { type: "Point", coordinates: coordenadas } } }
    );
    adaptadas += resultado.modifiedCount;
  }
  const indice = await corridas.createIndex({ "origem.localizacao": "2dsphere" }, { name: "idx_origem_geo" });
  console.log(JSON.stringify({ adaptadas, ignoradas, indice }));
}

prepararLocalizacao().catch(erro => {
  console.error("[Geo] Não foi possível preparar as localizações:", erro);
  process.exitCode = 1;
}).finally(closeMongo);
