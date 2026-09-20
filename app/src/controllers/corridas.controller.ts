import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../database/mongo.js";

export class CorridasController {
  // 1. Lista as corridas que ainda estão esperando um motorista
  static async listarDisponiveis(req: Request, res: Response): Promise<void> {
    try {
      const corridas = getCollection("corridas");

      const resultado = await corridas
        .find({
          status: "aguardando_motorista",
          motorista_id: null
        })
        .sort({ data_solicitacao: 1 })
        .toArray();

      res.json({
        total: resultado.length,
        dados: resultado
      });
    } catch (erro: any) {
      res.status(500).json({ erro: erro.message });
    }
  }

  // 2. Histórico de corridas de um passageiro
  static async historicoPassageiro(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        res.status(400).json({ erro: "ID do passageiro inválido." });
        return;
      }

      const corridas = getCollection("corridas");

      const resultado = await corridas
        .find({ passageiro_id: new ObjectId(id) })
        .sort({ data_solicitacao: -1 })
        .toArray();

      res.json({
        total: resultado.length,
        dados: resultado
      });
    } catch (erro: any) {
      res.status(500).json({ erro: erro.message });
    }
  }

  // 3. Histórico de corridas de um motorista
  static async historicoMotorista(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        res.status(400).json({ erro: "ID do motorista inválido." });
        return;
      }

      const corridas = getCollection("corridas");

      const resultado = await corridas
        .find({ motorista_id: new ObjectId(id) })
        .sort({ data_solicitacao: -1 })
        .toArray();

      res.json({
        total: resultado.length,
        dados: resultado
      });
    } catch (erro: any) {
      res.status(500).json({ erro: erro.message });
    }
  }

  // 4. Filtra corridas por status e faixa de valor
  static async filtrar(req: Request, res: Response): Promise<void> {
    try {
      const { status, valorMin, valorMax } = req.query;

      const filtro: any = {};

      if (status) {
        filtro.status = status;
      }

      if (valorMin || valorMax) {
        filtro.valor_estimado = {};

        if (valorMin) {
          filtro.valor_estimado.$gte = Number(valorMin);
        }

        if (valorMax) {
          filtro.valor_estimado.$lte = Number(valorMax);
        }
      }

      const corridas = getCollection("corridas");

      const resultado = await corridas
        .find(filtro)
        .sort({ data_solicitacao: -1 })
        .toArray();

      res.json({
        total: resultado.length,
        dados: resultado
      });
    } catch (erro: any) {
      res.status(500).json({ erro: erro.message });
    }
  }

  // 5. Motorista aceita uma corrida
  static async aceitar(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { motorista_id } = req.body;

      if (!ObjectId.isValid(id)) {
        res.status(400).json({ erro: "ID da corrida inválido." });
        return;
      }

      if (!motorista_id || !ObjectId.isValid(motorista_id)) {
        res.status(400).json({ erro: "ID do motorista inválido." });
        return;
      }

      const motoristas = getCollection("motoristas");

      const motorista = await motoristas.findOne({
        _id: new ObjectId(motorista_id),
        disponivel: true
      });

      if (!motorista) {
        res.status(404).json({
          erro: "Motorista não encontrado ou indisponível."
        });
        return;
      }

      const corridas = getCollection("corridas");
      const agora = new Date();

      const corridaAtualizada = await corridas.findOneAndUpdate(
        {
          _id: new ObjectId(id),
          status: "aguardando_motorista",
          motorista_id: null
        },
        {
          $set: {
            motorista_id: new ObjectId(motorista_id),
            status: "aceita",
            data_aceite: agora
          },
          $push: {
            historico_status: {
              status: "aceita",
              data: agora
            }
          }
        },
        {
          returnDocument: "after"
        }
      );

      if (!corridaAtualizada) {
        res.status(409).json({
          erro: "A corrida não está mais disponível."
        });
        return;
      }

      res.json({
        mensagem: "Corrida aceita com sucesso.",
        corrida: corridaAtualizada
      });
    } catch (erro: any) {
      res.status(500).json({ erro: erro.message });
    }
  }
}
