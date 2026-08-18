// POST /api/services/:id — simulated services (news, writing, grammar,
// code, review, weather) that follow the exact same x402 cycle:
// request → 402 → simulate payment → retry → success.

import { Router } from "express";
import { CATALOG } from "../services/catalog.js";
import { makeServiceRouter } from "./serviceRouter.js";

const router = Router();

router.use("/:id", (req, res, next) => {
  if (!CATALOG[req.params.id]) {
    return res.status(404).json({ error: `Unknown service: ${req.params.id}` });
  }
  next();
});

router.use("/:id", (req, res, next) => {
  makeServiceRouter(req.params.id)(req, res, next);
});

export default router;