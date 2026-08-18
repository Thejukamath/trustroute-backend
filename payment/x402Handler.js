// ============================================================================
// x402 Payment Handler — the payment layer of TrustRoute.
//
//   pay(invoice)         → "signs" / sends the micropayment and returns:
//                           { txId, round, fee, network, sim, explorerUrl }
//   verifyPayment(txId)  → checks the server-side registry for a settlement.
//
// ── REAL x402 / Algorand TestNet integration ────────────────────────────────
// REAL mode is the DEFAULT: when the wallet env vars are configured, every
// payment is built, signed and broadcast on-chain with algosdk against
// Algorand TestNet, and confirmed before returning a real txId + round.
//
//   Configure in server/.env (see scripts/setup-wallet.js — one command):
//
//     X402_MNEMONIC="25-word testnet mnemonic"      payer account (needs funds)
//     X402_RECIPIENT="ADDRESS…"                     service-provider receiving address
//     X402_ALGOD_URL="https://testnet-api.algonode.cloud"   (optional, default)
//
//   Fund the payer once via the official TestNet faucet:
//     https://bank.testnet.algorand.network/   (paste address → captcha → ALGO)
//
// SIMULATION is used ONLY when the wallet is not configured (or as an explicit
// opt-in via X402_SIM=1). If the configured payer has no funds, payments fail
// with a clear, actionable error — the handler never silently fakes a payment
// while REAL mode is enabled.
// ============================================================================

import { randomBytes } from "crypto";
import {
  registerInvoice,
  registerTransaction,
  getTransaction,
} from "./store.js";
import { trackPayment } from "../services/goplausible.js";

export const NETWORK = "Algorand Testnet";
export const EXPLORER = "https://testnet.explorer.perawallet.app/tx";

export const REAL_MODE =
  process.env.X402_SIM !== "1" &&
  Boolean(process.env.X402_MNEMONIC) &&
  Boolean(process.env.X402_RECIPIENT);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rand = (len) =>
  Array.from({ length: len }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

export function createInvoice({ service, price }) {
  const invoice = {
    invoiceId: `inv_${rand(16)}`,
    service,
    price,
    network: NETWORK,
    createdAt: Date.now(),
  };
  if (REAL_MODE && process.env.X402_RECIPIENT) {
    invoice.recipient = process.env.X402_RECIPIENT;
  }
  return registerInvoice(invoice);
}

export class RealPaymentError extends Error {
  constructor(message) {
    super(message);
    this.name = "RealPaymentError";
  }
}

// Payment-mode reporting for /health + startup logs.
export function getPaymentMode() {
  if (!REAL_MODE) {
    return {
      mode: "simulated",
      reason: process.env.X402_SIM === "1"
        ? "X402_SIM=1 set explicitly"
        : "wallet not configured — run `npm run setup-wallet` in server/",
    };
  }
  return { mode: "real", reason: "algosdk + Algorand TestNet wallet configured" };
}

// ---------------------------------------------------------------------------
// REAL Algorand TestNet path — the default when the wallet is configured.
// ---------------------------------------------------------------------------
const MIN_BALANCE = 100_000n; // microAlgos — Algorand requires every account
                              // to hold ≥ 0.1 ALGO at all times, receivers too.

async function tryRealPayment(invoice) {
  let algosdk;
  try {
    ({ default: algosdk } = await import("algosdk"));
  } catch {
    throw new RealPaymentError(
      "algosdk is not installed — run `npm install algosdk` in server/ to enable REAL payments."
    );
  }

  const mnemonic = process.env.X402_MNEMONIC;
  const recipient = process.env.X402_RECIPIENT;

  try {
    const account = algosdk.mnemonicToSecretKey(mnemonic);
    const url = process.env.X402_ALGOD_URL || "https://testnet-api.algonode.cloud";
    const client = new algosdk.Algodv2("", url, "");

    const params = await client.getTransactionParams().do();
    const amountMicro = BigInt(Math.max(Math.round(invoice.price * 1_000_000), 1_000)); // ≥ 0.001 ALGO

    // The recipient must already hold the 0.1 ALGO minimum balance or the
    // chain rejects the payment. On first use, top it up with its own
    // (free, testnet) activation transaction so every subsequent payment works.
    let activation = null;
    const recipInfo = await client.accountInformation(recipient).do();
    const recipBalance = BigInt(recipInfo.amount);
    if (recipBalance < MIN_BALANCE) {
      const activationTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: account.addr,
        receiver: recipient,
        amount: MIN_BALANCE - recipBalance,
        note: new TextEncoder().encode("TrustRoute: recipient activation"),
        suggestedParams: params,
      });
      const activationTxId = activationTxn.txID();
      const activationSigned = activationTxn.signTxn(account.sk);
      await client.sendRawTransaction(activationSigned).do();
      await algosdk.waitForConfirmation(client, activationTxId, 10);
      activation = {
        txId: activationTxId,
        amountMicro: (MIN_BALANCE - recipBalance).toString(),
      };
    }

    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: account.addr,
      receiver: recipient,
      amount: amountMicro,
      note: new TextEncoder().encode(`TrustRoute invoice ${invoice.invoiceId}`),
      suggestedParams: params,
    });

    const txId = txn.txID();
    const signed = txn.signTxn(account.sk);
    await client.sendRawTransaction(signed).do();
    const confirmed = await algosdk.waitForConfirmation(client, txId, 10);
    const round = Number(confirmed["confirmed-round"] ?? params.firstValid);

    const tx = {
      txId,
      round,
      fee: Number((txn.fee ?? params.fee) / 1000n) / 1000,
      network: NETWORK,
      invoiceId: invoice.invoiceId,
      sim: false,
      explorerUrl: `${EXPLORER}/${txId}`,
      activation,
    };
    registerTransaction(tx);
    return tx;
  } catch (err) {
    const msg = String(err?.message || err);
    if (/insufficient funds|overspend/i.test(msg)) {
      const account = algosdk.mnemonicToSecretKey(mnemonic);
      throw new RealPaymentError(
        `Payer wallet ${account.addr} has insufficient ALGO on TestNet. ` +
          `Fund it via the official faucet: https://bank.testnet.algorand.network/ ` +
          `(paste the address above, solve the captcha, click Send Me Algos).`
      );
    }
    throw new RealPaymentError(`Algorand TestNet payment failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Simulated path — used ONLY when the wallet is not configured (or X402_SIM=1).
// Structurally identical to the real one.
// ---------------------------------------------------------------------------
async function simulatePayment(invoice) {
  await sleep(400 + Math.random() * 400);

  const txId = `TX-${rand(6).toUpperCase()}-${rand(6).toUpperCase()}`;
  const tx = {
    txId,
    round: 4_900_000 + Math.floor(Math.random() * 9_000),
    fee: 0.001,
    network: NETWORK,
    invoiceId: invoice.invoiceId,
    sim: true,
    explorerUrl: `${EXPLORER}/${txId}`,
  };
  registerTransaction(tx);
  return tx;
}

// Accepts an invoice (from createInvoice or a 402 response), settles the
// payment and returns a verifiable transaction object.
//
// Every attempt is tracked with GoPlausible FIRST (initiated → success/failed),
// so the analytics layer sees the full payment lifecycle without touching any
// of the algosdk / Algorand TestNet logic below.
export async function pay(invoice) {
  await trackPayment({
    service: invoice.service,
    amount: invoice.price,
    status: "initiated",
    invoiceId: invoice.invoiceId,
  });

  try {
    const tx = REAL_MODE ? await tryRealPayment(invoice) : await simulatePayment(invoice);
    await trackPayment({
      service: invoice.service,
      amount: invoice.price,
      status: "success",
      txId: tx.txId,
      invoiceId: invoice.invoiceId,
      timestamp: tx.round ? Date.now() : undefined,
    });
    return tx;
  } catch (err) {
    await trackPayment({
      service: invoice.service,
      amount: invoice.price,
      status: "failed",
      error: String(err?.message || err).slice(0, 120),
      invoiceId: invoice.invoiceId,
    });
    throw err;
  }
}

// Server-side validation used when a request arrives with `x-payment-tx`.
export function verifyPayment(txId) {
  return getTransaction(txId);
}