import { performance } from "node:perf_hooks";
import { ObjectId } from "mongodb";
import { connectMongo, getCollection, closeMongo } from "../database/mongo.js";

async function medirRota() {
  const requisicoes = Number(process.env.REQUISICOES || 1000);
  const concorrencia = Number(process.env.CONCORRENCIA || 10);
  if (!Number.isInteger(requisicoes) || requisicoes < 1 || requisicoes > 100000 ||
      !Number.isInteger(concorrencia) || concorrencia < 1 || concorrencia > 100) {
    throw new Error("REQUISICOES deve ser de 1 a 100000 e CONCORRENCIA de 1 a 100.");
  }
  let id = process.env.PASSAGEIRO_TESTE_ID;
  if (!id) {
    await connectMongo();
    const exemplo = await getCollection("corridas_carga").findOne({}, { sort: { _id: 1 } });
    if (!exemplo) throw new Error("Execute npm run seed:carga primeiro.");
    id = exemplo.passageiro_id.toString();
  }
  if (!id || !ObjectId.isValid(id)) throw new Error("PASSAGEIRO_TESTE_ID inválido.");
  await closeMongo();
  const base = process.env.BENCHMARK_BASE_URL || "http://localhost:3400";
  const url = `${base}/api/desempenho/historico/${id}`;
  const latencias: number[] = [];
  const errosHttp: Record<string, number> = {};
  let sucessos = 0;
  let errosConexao = 0;
  let proxima = 0;

  async function executarWorker() {
    while (proxima < requisicoes) {
      proxima++;
      const inicio = performance.now();
      try {
        const resposta = await fetch(url, { signal: AbortSignal.timeout(10000) });
        await resposta.text(); // Inclui a leitura do corpo na latência.
        if (resposta.ok) sucessos++;
        else errosHttp[resposta.status] = (errosHttp[resposta.status] || 0) + 1;
      } catch {
        errosConexao++;
      }
      latencias.push(performance.now() - inicio);
    }
  }

  const inicio = performance.now();
  await Promise.all(Array.from({ length: Math.min(concorrencia, requisicoes) }, executarWorker));
  const duracao = performance.now() - inicio;
  latencias.sort((a, b) => a - b);
  const valido = sucessos === requisicoes;
  console.log(JSON.stringify({ valido, url, passageiro_teste_id: id, requisicoes, concorrencia,
    respostas_2xx: sucessos, erros_http: errosHttp, erros_conexao: errosConexao,
    duracao_ms: Number(duracao.toFixed(2)),
    vazao_req_s: Number((latencias.length / (duracao / 1000)).toFixed(2)),
    p95_ms: Number(latencias[Math.ceil(latencias.length * 0.95) - 1].toFixed(2)) }, null, 2));
  if (!valido) {
    console.error("[Benchmark] Houve falhas; não comparar como medição válida de desempenho.");
    process.exitCode = 1;
  }
}

medirRota().catch(erro => {
  console.error("[Benchmark] Não foi possível medir a rota:", erro);
  process.exitCode = 1;
}).finally(closeMongo);
