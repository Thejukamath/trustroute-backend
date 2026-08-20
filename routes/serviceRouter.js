// Shared paid service router.
//
// Payment is enforced by the x402 middleware (server/x402/paywall.js) which
// sits in front of ALL protected routes:
//
//   1. no `PAYMENT-SIGNATURE` header  → HTTP 402 + PAYMENT-REQUIRED header
//      (client signs a USDC transfer and retries with PAYMENT-SIGNATURE)
//   2. the facilitator verifies + settles the on-chain payment
//   3. the middleware rewinds and runs this handler → product + provider logs
//
// The settled transaction id travels back to the client in the PAYMENT-RESPONSE
// header (set by the middleware after the handler returns), where the client
// merges it into the response body it returns to the UI.

import { Router } from "express";
import { CATALOG, OUTPUT_TOKENS } from "../services/catalog.js";
import { fetchProvider } from "../services/providers.js";
import { makeLogger } from "../utils/logger.js";
import { NETWORK } from "../x402/paywall.js";

export function makeServiceRouter(serviceId) {
  const router = Router();
  const svc = CATALOG[serviceId];

  router.post("/", async (req, res) => {
    const task = String(req.body?.task || "").trim();

    if (!svc) {
      return res.status(404).json({ error: `Unknown service: ${serviceId}` });
    }
    if (!task) {
      return res.status(400).json({ error: "task is required" });
    }

    const logs = makeLogger();

    // ── provider call with failover ────────────────────────────────────────
    let failover = false;
    const attempt = await fetchProvider(serviceId, task, logs, (kind) => {
      if (kind === "failover") failover = true;
    });

    const tokens = OUTPUT_TOKENS[serviceId] ?? 300;
    logs.add(
      "RESULT_RECEIVED",
      `200 OK · ${attempt.provider ?? attempt.url} · ${tokens} output tokens · ${attempt.ms}ms · ${(tokens * 0.18).toFixed(1)} KB`,
      "success",
      serviceId,
      300
    );

    res.json({
      result: attempt.payload,
      service: svc.name,
      serviceId,
      network: NETWORK,
      provider: attempt.backup ? "backup" : "primary",
      providerName: attempt.provider ?? attempt.url,
      failover,
      latencyMs: attempt.ms,
      logs: logs.logs,
    });
  });

  return router;
}