import { Router } from "express";
import { historicoCarga } from "../controllers/desempenho.controller.js";

const router = Router();
router.get("/historico/:passageiroId", historicoCarga);
export default router;
