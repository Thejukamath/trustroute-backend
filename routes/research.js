// POST /api/research — the REAL x402-compatible endpoint.
//
// One real endpoint with an HTTP 402 Payment Required contract, a payment
// signing flow (server-side x402Handler), a retry mechanism and a verifiable
// transaction ID on Algorand TestNet.

import { Router } from "express";
import { makeServiceRouter } from "./serviceRouter.js";

const router = Router();
router.use(makeServiceRouter("research"));

export default router;