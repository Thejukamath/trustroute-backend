// Shared x402-compatible service router.
//
// Flow (identical for the REAL /api/research endpoint and simulated services):
//   1. no `x-payment-tx` header  → HTTP 402 Payment Required + invoice
//   2. client pays the invoice via the payment layer → txId
//   3. client retries with `x-payment-tx: <txId>`
//   4. server validates the tx against the settlement registry → runs provider
//      (with failover) → returns { result, transactionId }

import { Router } from "express";
import { CATALOG, OUTPUT_TOKENS } from "../services/catalog.js";
import { fetchProvider } from "../services/providers.js";
import {
  createInvoice,
  pay,
  verifyPayment,
  NETWORK,
} from "../payment/x402Handler.js";
import { makeLogger } from "../utils/logger.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const txId = String(req.get("x-payment-tx") || "");

    // ── STEP 1: no payment → HTTP 402 Payment Required ─────────────────────
    if (!txId) {
      const invoice = createInvoice({ service: serviceId, price: svc.cost });
      return res.status(402).json({
        error: "Payment Required",
        price: svc.cost,
        invoiceId: invoice.invoiceId,
        network: NETWORK,
        recipient: invoice.recipient,
      });
    }

    // ── STEP 5: validate the presented transaction ─────────────────────────
    const tx = verifyPayment(txId);
    if (!tx) {
      const invoice = createInvoice({ service: serviceId, price: svc.cost });
      return res.status(402).json({
        error: "Payment Required — invalid or expired transaction, please pay again",
        price: svc.cost,
        invoiceId: invoice.invoiceId,
        network: NETWORK,
      });
    }

    logs.add("REQUEST_RETRIED", `Retrying with x-payment-tx: ${txId}`, "success", serviceId, 250);
    logs.add("PAYMENT_VERIFIED", `Payment verified on-chain · round ${tx.round} · fee ${tx.fee} ALGO`, "success", serviceId, 250);

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

    await sleep(150);

    res.json({
      result: attempt.payload,
      transactionId: txId,
      service: svc.name,
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