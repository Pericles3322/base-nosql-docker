import { ObjectId } from "mongodb";
import { connectMongo, getCollection, closeMongo } from "../database/mongo.js";

async function gerenciarIndice() {
  const acao = process.argv[2] || "explain";
  if (!["criar", "remover", "explain"].includes(acao)) throw new Error("Use indice:carga -- criar|remover|explain");
  await connectMongo();
  const colecao = getCollection("corridas_carga");
  const exemplo = await colecao.findOne({}, { sort: { _id: 1 } });
  if (!exemplo) throw new Error("Execute npm run seed:carga primeiro.");
  const nome = "idx_passageiro_data";
  if (acao === "criar") {
    await colecao.createIndex({ passageiro_id: 1, data_solicitacao: -1 }, { name: nome });
  } else if (acao === "remover") {
    if ((await colecao.indexes()).some(indice => indice.name === nome)) await colecao.dropIndex(nome);
  }
  const id = process.env.PASSAGEIRO_TESTE_ID || exemplo.passageiro_id.toString();
  if (!ObjectId.isValid(id)) throw new Error("PASSAGEIRO_TESTE_ID inválido.");
  const plano = await colecao.find({ passageiro_id: new ObjectId(id) })
    .sort({ data_solicitacao: -1 }).limit(10).explain("executionStats");
  console.log(JSON.stringify({ acao, colecao: "corridas_carga", total: await colecao.countDocuments(),
    passageiro_teste_id: id, indices: await colecao.indexes(),
    nReturned: plano.executionStats.nReturned,
    totalDocsExamined: plano.executionStats.totalDocsExamined,
    totalKeysExamined: plano.executionStats.totalKeysExamined,
    executionTimeMillis: plano.executionStats.executionTimeMillis,
    winningPlan: plano.queryPlanner.winningPlan }, null, 2));
}

gerenciarIndice().catch(erro => {
  console.error("[Índice] Falha ao medir a coleção auxiliar:", erro);
  process.exitCode = 1;
}).finally(closeMongo);
