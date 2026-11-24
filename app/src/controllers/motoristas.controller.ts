import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";
import { getRedisClient } from "../database/redis.js";
import { coordenadasValidas, lerBuscaPorRaio } from "../services/localizacao.js";

const CHAVE_GEO = "borala:geo:motoristas";
// O Redis GEO não cobre os polos: seu limite de latitude é menor que o do GeoJSON.
const LATITUDE_REDIS = 85.05112878;

export async function atualizarLocalizacao(req: Request, res: Response): Promise<void> {
  if (!ObjectId.isValid(req.params.id)) {
    res.status(400).json({ erro: "ID do motorista inválido." }); return;
  }
  const { longitude, latitude } = req.body || {};
  if (!coordenadasValidas(longitude, latitude, LATITUDE_REDIS)) {
    res.status(400).json({ erro: "Longitude deve estar entre -180 e 180; latitude entre -85.05112878 e 85.05112878, em números finitos." }); return;
  }
  const id = new ObjectId(req.params.id);
  try {
    const motorista = await getCollection("motoristas").findOne({ _id: id }, { projection: { _id: 1 } });
    if (!motorista) { res.status(404).json({ erro: "Motorista não encontrado." }); return; }
  } catch (erro) {
    console.error("[Motoristas] MongoDB indisponível:", erro);
    res.status(503).json({ erro: "Não foi possível consultar o motorista: MongoDB indisponível." }); return;
  }
  try {
    await getRedisClient().geoadd(CHAVE_GEO, longitude, latitude, id.toHexString());
    res.json({ mensagem: "Localização temporária atualizada.", motorista_id: id, longitude, latitude });
  } catch (erro) {
    console.error("[Motoristas] Redis GEO indisponível:", erro);
    res.status(503).json({ erro: "Posição em tempo real temporariamente indisponível: Redis fora do ar." });
  }
}

export async function motoristasPerto(req: Request, res: Response): Promise<void> {
  const parametros = lerBuscaPorRaio(req.query, LATITUDE_REDIS);
  if (!parametros) {
    res.status(400).json({ erro: "Informe longitude (-180 a 180), latitude (-85.05112878 a 85.05112878) e raioKm maior que zero e até 30." }); return;
  }
  const { longitude, latitude, raioKm } = parametros;
  try {
    const resultado = await getRedisClient().geosearch(CHAVE_GEO, "FROMLONLAT", longitude, latitude,
      "BYRADIUS", raioKm, "km", "ASC", "COUNT", 20, "WITHDIST") as [string, string][];
    const dados = resultado.map(([id, distancia]) => ({ motorista_id: id, distancia_km: Number(distancia) }));
    res.json({ total: dados.length, dados });
  } catch (erro) {
    console.error("[Motoristas] Redis GEO indisponível:", erro);
    res.status(503).json({ erro: "Busca de posição em tempo real indisponível: Redis fora do ar." });
  }
}
