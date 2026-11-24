import { Router } from "express";
import { atualizarLocalizacao, motoristasPerto } from "../controllers/motoristas.controller.js";

const router = Router();
router.get("/perto", motoristasPerto);
router.post("/:id/localizacao", atualizarLocalizacao);
export default router;
