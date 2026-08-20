// End-to-end client-side x402 handshake test (Node, same @x402 packages the
// browser uses). Starts the local server in REAL mode and drives:
//   1. POST /api/services/weather          → 402 + PAYMENT-REQUIRED
//   2. spend policy (localhost stand-in)
//   3. sign payment payload with the generated payer key (unfunded)
//   4. retry with PAYMENT-SIGNATURE
//   5. read PAYMENT-RESPONSE
// Expected result: facilitator rejects the signature (wallet never funded),
// OR — after the wallet is funded/opted-in — returns a 200 with a real tx.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { spawn } from "node:child_process";
import "dotenv/config";
import * as algosdk from "algosdk";

import { ExactAvmScheme, toClientAvmSigner } from "@x402/avm";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";

const BASE = "http://localhost:4000";
const NETWORK = `algorand:${process.env.AVM_GENESIS_HASH ?? "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI="}`;

const sk = Buffer.from(process.env.AVM_PRIVATE_KEY, "base64");
const client = new x402HTTPClient(
  new x402Client().register(NETWORK, new ExactAvmScheme(toClientAvmSigner(process.env.AVM_PRIVATE_KEY)))
);

async function step(label, fn) {
  try {
    const out = await fn();
    console.log(`✔ ${label}`);
    return out;
  } catch (err) {
    console.log(`✖ ${label} — ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

async function main() {
  console.log("payer addr:", algosdk.encodeAddress(sk.slice(32)));

  const first = await step("1. plain POST → 402 Payment Required", async () => {
    const res = await fetch(`${BASE}/api/services/weather`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "weather in Mysore" }),
    });
    if (res.status !== 402) throw new Error(`expected 402, got ${res.status}`);
    return res;
  });

  const paymentRequired = await step("2. decode PAYMENT-REQUIRED", async () => {
    const pr = client.getPaymentRequiredResponse((n) => first.headers.get(n), await first.json());
    if (!pr?.accepts?.length) throw new Error("no payment options");
    const a = pr.accepts[0];
    console.log("   amount:", a.amount, "· network:", a.network, "· payTo:", a.payTo);
    return pr;
  });

  const amountAtomic = Number(paymentRequired.accepts[0].amount);
  if (amountAtomic > 20000) throw new Error(`price mismatch: ${amountAtomic}`);

  const payload = await step("3. sign payment payload (exact scheme)", () =>
    client.createPaymentPayload(paymentRequired)
  );
  const headers = client.encodePaymentSignatureHeader(payload);

  const second = await step("4. retry with PAYMENT-SIGNATURE", async () => {
    const res = await fetch(`${BASE}/api/services/weather`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ task: "weather in Mysore" }),
    });
    const body = await res.text();
    console.log("   status:", res.status, "· body:", body.slice(0, 220));
    return { res, body };
  });

  const settle = (() => {
    try {
      return client.getPaymentSettleResponse((n) => second.res.headers.get(n));
    } catch {
      return null;
    }
  })();
  if (settle) {
    console.log("   PAYMENT-RESPONSE:", JSON.stringify(settle.transaction ?? settle).slice(0, 180));
  } else {
    const raw = second.res.headers.get("PAYMENT-RESPONSE") ?? second.res.headers.get("PAYMENT-REQUIRED");
    if (raw) {
      const decoded = Buffer.from(raw, "base64").toString("utf8");
      console.log("   settlement header (raw):", decoded.slice(0, 220));
    } else {
      console.log("   (no PAYMENT-RESPONSE header — payment not settled)");
    }
  }

  console.log("\nDone. If the facilitator rejected you, fund + opt in the payer");
  console.log("wallet, then re-run this script for a REAL on-chain settlement.");
}

main().catch((err) => {
  console.error("\nTest failed:", err.message);
  process.exit(1);
});