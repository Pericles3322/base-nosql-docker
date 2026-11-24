import { ObjectId } from "mongodb";
import { connectMongo, getCollection, closeMongo } from "../database/mongo.js";

async function gerarCarga() {
  await connectMongo();
  const colecao = getCollection("corridas_carga");
  const existentes = await colecao.countDocuments();
  if (existentes > 0) {
    const exemplo = await colecao.findOne({}, { sort: { _id: 1 } });
    console.log(JSON.stringify({ colecao: "corridas_carga", total: existentes, seed_pulado: true,
      passageiro_teste_id: exemplo?.passageiro_id.toString() }));
    return;
  }
  // IDs sintéticos, restritos à coleção auxiliar. Nenhum cadastro real é alterado.
  const passageiros = Array.from({ length: 100 }, (_, i) => new ObjectId((i + 1).toString(16).padStart(24, "0")));
  for (let inicio = 0; inicio < 30000; inicio += 1000) {
    const lote = Array.from({ length: 1000 }, (_, j) => {
      const i = inicio + j;
      return { passageiro_id: passageiros[i % 100],
        data_solicitacao: new Date(Date.UTC(2026, 0, 1) + i * 60000),
        status: "finalizada", valor_estimado: 10 + (i % 500) / 10 };
    });
    await colecao.insertMany(lote);
  }
  console.log(JSON.stringify({ colecao: "corridas_carga", total: await colecao.countDocuments(),
    seed_pulado: false, passageiros: 100, corridas_por_passageiro: 300,
    passageiro_teste_id: passageiros[0].toHexString() }));
}

gerarCarga().catch(erro => {
  console.error("[Carga] Falha na coleção auxiliar corridas_carga:", erro);
  process.exitCode = 1;
}).finally(closeMongo);
