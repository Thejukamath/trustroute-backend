// POST /api/pay — payment trigger. The client calls this when it receives a
// 402: the server-side x402Handler signs the payment for the invoice and
// returns a verifiable transaction.

import { Router } from "express";
import { pay, createInvoice, RealPaymentError } from "../payment/x402Handler.js";
import { getInvoice } from "../payment/store.js";

const router = Router();

router.post("/", async (req, res) => {
  const { invoiceId, service, price } = req.body || {};

  let invoice = invoiceId ? getInvoice(invoiceId) : null;

  // Allow standalone payments: { service, price } → mint an invoice on the fly.
  if (!invoice && service && price > 0) {
    invoice = createInvoice({ service, price });
  }

  if (!invoice) {
    return res.status(404).json({ error: "Invoice not found — please request the service first to receive a 402 invoice." });
  }

  try {
    const tx = await pay(invoice);
    res.json({
      txId: tx.txId,
      round: tx.round,
      fee: tx.fee,
      network: tx.network,
      sim: tx.sim,
      explorerUrl: tx.explorerUrl,
      activation: tx.activation ?? null,
    });
  } catch (err) {
    if (err instanceof RealPaymentError) {
      return res.status(503).json({
        error: err.message,
        code: "REAL_PAYMENT_UNAVAILABLE",
        network: invoice.network,
      });
    }
    res.status(500).json({ error: `Payment failed: ${err.message}` });
  }
});

export default router;