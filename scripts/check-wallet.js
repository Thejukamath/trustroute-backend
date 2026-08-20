// Check x402 wallet state + balances without generating a new wallet.
//   npm run check-wallet
//
// REQUIRED to pay: payer has ALGO + USDC (ASA 10458941) + opted-in;
// REQUIRED to receive: AVM_ADDRESS has ALGO (MBR) + USDC opted-in.

import algosdk from "algosdk";
import "dotenv/config";

const ALGOD_URL = process.env.ALGOD_URL || "https://testnet-api.algonode.cloud";
const USDC_ASA = 10458941;
const toAddr = (a) => (typeof a === "string" ? a : a.toString());

async function info(client, address) {
  const i = await client.accountInformation(address).do();
  const usdcAsset = (i.assets ?? []).find((a) => a["asset-id"] === USDC_ASA);
  return {
    algo: Number(i.amount) / 1e6,
    usdc: (usdcAsset?.amount ?? 0) / 1e6,
    optedIn: Boolean(usdcAsset),
  };
}

async function main() {
  const client = new algosdk.Algodv2("", ALGOD_URL, "");
  const hasPayerKey = Boolean(process.env.AVM_PRIVATE_KEY || process.env.AVM_MNEMONIC);
  const payTo = process.env.AVM_ADDRESS || "";

  console.log("x402 paywall :", payTo ? "configured (real)" : "UNCONFIGURED (paid routes return 503)");

  if (hasPayerKey) {
    let payerAddr;
    if (process.env.AVM_PRIVATE_KEY) {
      const sk = Buffer.from(process.env.AVM_PRIVATE_KEY, "base64");
      if (sk.length !== 64) throw new Error("AVM_PRIVATE_KEY must be a base64 64-byte key (seed + pubkey)");
      const addr = algosdk.encodeAddress(sk.slice(32));
      payerAddr = addr;
    } else {
      payerAddr = toAddr(algosdk.mnemonicToSecretKey(process.env.AVM_MNEMONIC).addr);
    }
    console.log("Payer :", payerAddr);
    try {
      const p = await info(client, payerAddr);
      console.log(`  ALGO : ${p.algo.toFixed(6)}   USDC: ${p.usdc.toFixed(6)}   opted-in: ${p.optedIn}`);
      if (p.algo < 0.2) console.log("  ⚠  Need > 0.2 ALGO — fund at https://lora.algokit.io/testnet/fund");
      if (!p.optedIn) console.log("  ⚠  Not opted into USDC 10458941 — send a 0-amount USDC transfer to itself");
    } catch (err) {
      console.log(`  ⚠  Balance check failed: ${err.message}`);
    }
  } else {
    console.log("Payer : none configured (set AVM_PRIVATE_KEY or AVM_MNEMONIC, or run `npm run setup-wallet`)");
  }

  if (payTo) {
    console.log("PayTo :", payTo);
    try {
      const r = await info(client, payTo);
      console.log(`  ALGO : ${r.algo.toFixed(6)}   USDC: ${r.usdc.toFixed(6)}   opted-in: ${r.optedIn}`);
      if (r.algo < 0.2) console.log("  ⚠  Need > 0.2 ALGO (MBR) — fund at https://lora.algokit.io/testnet/fund");
      if (!r.optedIn) console.log("  ⚠  Not opted into USDC 10458941 — essential to RECEIVE USDC");
    } catch (err) {
      console.log(`  ⚠  Balance check failed: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error("Check failed:", err);
  process.exit(1);
});