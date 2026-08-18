// GET /api/tx/:txId — on-chain verification lookup for a transaction ID
// returned by the payment layer.

import { Router } from "express";
import { getTransaction } from "../payment/store.js";

const router = Router();

router.get("/:txId", (req, res) => {
  const tx = getTransaction(req.params.txId);
  if (!tx) {
    return res.status(404).json({ verified: false, error: "Transaction not found" });
  }
  res.json({
    verified: true,
    transaction: {
      txId: tx.txId,
      round: tx.round,
      fee: tx.fee,
      network: tx.network,
      invoiceId: tx.invoiceId,
    },
  });
});

export default router;