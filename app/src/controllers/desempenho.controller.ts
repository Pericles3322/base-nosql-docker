import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";

export async function historicoCarga(req: Request, res: Response): Promise<void> {
  if (!ObjectId.isValid(req.params.passageiroId)) {
    res.status(400).json({ erro: "ID do passageiro inválido." }); return;
  }
  try {
    // Mesma consulta do domínio, em coleção auxiliar e sem Redis para medir o índice.
    const dados = await getCollection("corridas_carga")
      .find({ passageiro_id: new ObjectId(req.params.passageiroId) })
      .sort({ data_solicitacao: -1 }).limit(10).toArray();
    res.json({ total: dados.length, dados });
  } catch (erro) {
    console.error("[Desempenho] MongoDB indisponível:", erro);
    res.status(503).json({ erro: "Histórico de teste indisponível: MongoDB fora do ar." });
  }
}
