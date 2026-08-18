// POST /api/plan — the agent's autonomous decision step: keyword-based rule
// engine selects services, orders by priority, checks the budget.

import { Router } from "express";
import { buildPlan } from "../agent/planner.js";

const router = Router();

router.post("/", (req, res) => {
  const { task = "", budget, priority = "Speed" } = req.body || {};

  if (typeof task !== "string" || !task.trim()) {
    return res.status(400).json({ error: "task is required" });
  }
  const parsedBudget = Number(budget);
  if (!Number.isFinite(parsedBudget) || parsedBudget <= 0) {
    return res.status(400).json({ error: "budget must be a positive number" });
  }

  res.json(buildPlan(task.trim(), parsedBudget, priority));
});

export default router;