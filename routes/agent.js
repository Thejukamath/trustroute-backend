// POST /api/run-agent — the smart agent engine endpoint.
//
// Input:  { task, budget?, priority? }   priority: cheapest | fastest | reliable | balanced
// Output: {
//   task, steps, priority, budget, usedFailover,
//   results: [ { success, category, service, result, latencyMs, usedFailover, attempts } ]
// }
//
// No x402 here — this endpoint showcases the selection engine (classify →
// score → failover). The x402 payment loop stays on the /api/plan +
// /api/services/:id path used by the dashboard.

import { Router } from "express";
import { runAgent } from "../agent/engine.js";

const router = Router();

const VALID_PRIORITIES = ["cheapest", "fastest", "reliable", "balanced"];

router.post("/", async (req, res) => {
  const task = String(req.body?.task ?? "").trim();
  const priority = String(req.body?.priority ?? "balanced").toLowerCase();
  const budget = Number(req.body?.budget ?? 5);

  if (!task) {
    return res.status(400).json({ error: "task is required" });
  }
  if (!VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `priority must be one of: ${VALID_PRIORITIES.join(", ")}` });
  }

  try {
    const outcome = await runAgent(task, priority, budget);
    res.json(outcome);
  } catch (err) {
    console.error("[agent] run-agent failed:", err);
    res.status(500).json({ error: "Agent run failed", detail: String(err.message) });
  }
});

export default router;