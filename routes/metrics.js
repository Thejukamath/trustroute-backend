// GET /api/metrics — GoPlausible-aggregated payment analytics (in-memory).

import { Router } from "express";
import { getMetrics } from "../services/goplausible.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json(getMetrics());
});

export default router;