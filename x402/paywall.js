// ============================================================================
// Real x402 payment wall — @x402 protocol v2, "exact" scheme, Algorand TestNet.
//
//   network      algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe   (TestNet CAIP-2)
//   currency     USDC — Algorand Standard Asset 10458941 (TestNet), 6 decimals
//   facilitator  https://facilitator.goplausible.xyz
//   payTo        AVM_ADDRESS (the address that receives USDC)
//
// Every protected endpoint returns HTTP 402 + a `PAYMENT-REQUIRED` header
// when no valid payment signature is attached. Clients decode the header,
// sign a USDC transfer with their AVM wallet, and retry with a
// `PAYMENT-SIGNATURE` header. The facilitator verifies + settles the on-chain
// transaction, and the resource server records it via PAYMENT-RESPONSE.
//
// There is no simulated/mocked payment path: if AVM_ADDRESS is not configured,
// protected endpoints return 503 so it is impossible to fake a payment.
// ============================================================================

import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactAvmScheme } from "@x402/avm/exact/server";
import {
  ALGORAND_TESTNET_GENESIS_HASH,
  USDC_TESTNET_ASA_ID,
  USDC_DECIMALS,
} from "@x402/avm";
import { trackPayment } from "../services/goplausible.js";

// ── protocol constants ───────────────────────────────────────────────────────
// The facilitator (and this x402 toolchain) registers Algorand networks by the
// FULL base64 genesis hash, NOT the official short CAIP-2 segment:
//   "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI="   ← TestNet
export const GENESIS_HASH =
  process.env.AVM_GENESIS_HASH || ALGORAND_TESTNET_GENESIS_HASH;
export const NETWORK =
  process.env.AVM_NETWORK || `algorand:${ALGORAND_TESTNET_GENESIS_HASH}`;
export const NETWORK_LABEL = "Algorand TestNet";
export const ASSET = USDC_TESTNET_ASA_ID; // "10458941"
export const ASSET_SYMBOL = "USDC";
export const DECIMALS = USDC_DECIMALS; // 6
export const FACILITATOR_URL =
  process.env.FACILITATOR_URL || "https://facilitator.goplausible.xyz";

// Server env var is AVM_ADDRESS — a plain 58-char Algorand address. Never a key.
export const PAY_TO = String(process.env.AVM_ADDRESS || "").trim();
export const x402Configured = Boolean(PAY_TO);

// Price per endpoint (Exact scheme — USD strings converted to USDC micro-units).
export const PRICES = {
  "/api/research": "$0.05", // 50_000 uUSDC
  "/api/services": "$0.02", // 20_000 uUSDC
};

export function isProtectedPath(method, path) {
  if (method !== "POST") return false;
  if (path === "/api/research") return true;
  if (path.startsWith("/api/services/")) return true;
  return false;
}

// ── routes config ────────────────────────────────────────────────────────────
function buildRoutes() {
  const acceptsFor = (price) => ({
    scheme: "exact",
    network: NETWORK,
    payTo: PAY_TO,
    price,
    maxTimeoutSeconds: 300,
  });

  return {
    "POST /api/research": {
      accepts: acceptsFor(PRICES["/api/research"]),
      description: `AI research endpoint — ${priceLabel(PRICES["/api/research"])} USDC on Algorand TestNet`,
      mimeType: "application/json",
    },
    "POST /api/services/*": {
      accepts: acceptsFor(PRICES["/api/services"]),
      description: `AI service endpoint — ${priceLabel(PRICES["/api/services"])} USDC on Algorand TestNet`,
      mimeType: "application/json",
    },
  };
}

function priceLabel(price) {
  return price.replace("$", "$");
}

// ── resource server + facilitator ────────────────────────────────────────────
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

const resourceServer = new x402ResourceServer(facilitatorClient).register(
  NETWORK,
  new ExactAvmScheme()
);

// Record every successful settlement in GoPlausible analytics straight from the
// protocol layer — no mocked events, only verified on-chain payments.
resourceServer.onAfterSettle(async (ctx = {}) => {
  try {
    const settleResult = ctx.settleResult ?? {};
    const transaction = settleResult.transaction;
    const txId =
      (transaction && (transaction.id || transaction.txId || transaction.txid)) ||
      settleResult.txId ||
      null;
    const requirements = ctx.paymentRequirements ?? {};
    const amountAtomic = String(requirements.amount ?? "0");
    const amountUsd = Number(amountAtomic) / 10 ** DECIMALS;
    await trackPayment({
      service: "x402",
      amount: amountUsd,
      status: "success",
      txId: txId || undefined,
      network: NETWORK,
    });
  } catch {
    // analytics must never break a settlement
  }
});

export const x402PaymentMiddleware = x402Configured
  ? paymentMiddleware(buildRoutes(), resourceServer, undefined, undefined, true)
  : (req, res, next) => {
      if (isProtectedPath(req.method, req.path)) {
        return res.status(503).json({
          error:
            "x402 is not configured — set AVM_ADDRESS in server/.env to enable real USDC payments on Algorand TestNet.",
        });
      }
      return next();
    };

export function getX402Status() {
  return {
    mode: x402Configured ? "real" : "unconfigured",
    protocol: "x402",
    scheme: "exact",
    network: NETWORK,
    networkLabel: NETWORK_LABEL,
    genesisHash: GENESIS_HASH,
    asset: ASSET,
    assetSymbol: ASSET_SYMBOL,
    decimals: DECIMALS,
    facilitator: FACILITATOR_URL,
    payTo: PAY_TO || null,
  };
}