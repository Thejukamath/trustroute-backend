// One-command x402 wallet setup for TrustRoute (Algorand TestNet, USDC).
//
//   npm run setup-wallet
//
// Generates a fresh TestNet payer account (CLIENT wallet) and a receiving
// account (RESOURCE SERVER / payTo), writes the values into server/.env and
// prints everything you need for client/.env.
//
// The payer (client) must before the first payment:
//   1. receive testnet ALGO   → https://lora.algokit.io/testnet/fund
//   2. receive testnet USDC   → https://faucet.circle.com/  (ASA 10458941)
//   3. opt in to USDC ASA     → send a 0-amount USDC transfer to itself
// The receiving (payTo) account needs ALGO (MBR) + USDC opt-in too.

import algosdk from "algosdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
const ALGOD_URL = process.env.ALGOD_URL || "https://testnet-api.algonode.cloud";

const skToBase64 = (sk) => Buffer.from(sk).toString("base64");

async function getBalance(address) {
  const client = new algosdk.Algodv2("", ALGOD_URL, "");
  const info = await client.accountInformation(address).do();
  return {
    algo: Number(info.amount), // microAlgos
    assets: (info.assets ?? []).filter((a) => a.assetId || a["asset-id"]) || [],
  };
}

async function main() {
  const payer = algosdk.generateAccount(); // client / signer
  const receiver = algosdk.generateAccount(); // resource server / payTo

  const payerAddr = typeof payer.addr === "string" ? payer.addr : payer.addr.toString();
  const receiverAddr = typeof receiver.addr === "string" ? receiver.addr : receiver.addr.toString();
  const payerMnemonic = algosdk.secretKeyToMnemonic(payer.sk);
  const payerPrivateKey = skToBase64(payer.sk); // seed+pubkey → @x402/avm signer

  const lines = [
    "# TrustRoute x402 wallets (Algorand TestNet, USDC ASA 10458941) — do not commit this file",
    `# RESOURCE SERVER — receives USDC payments:`,
    `AVM_ADDRESS=${receiverAddr}`,
    "# CLIENT wallet (for client/.env as VITE_AVM_MNEMONIC / VITE_AVM_PRIVATE_KEY):",
    `AVM_MNEMONIC="${payerMnemonic}"`,
    `AVM_PRIVATE_KEY=${payerPrivateKey}`,
    `ALGOD_URL=${ALGOD_URL}`,
    "",
  ];
  fs.writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });

  console.log("✔ Wrote server/.env");
  console.log("──────────────────────────────────────────────────────────────");
  console.log("RESOURCE SERVER / payTo  :", receiverAddr, "(AVM_ADDRESS → server/.env, already written)");
  console.log("CLIENT / payer address   :", payerAddr);
  console.log("CLIENT mnemonic          :", payerMnemonic, "(VITE_AVM_MNEMONIC → client/.env)");
  console.log("CLIENT private key (b64) :", payerPrivateKey, "(VITE_AVM_PRIVATE_KEY → client/.env)");
  console.log("──────────────────────────────────────────────────────────────");
  console.log("Before paying you must fund + opt in BOTH accounts:");
  console.log(`  ALGO : https://lora.algokit.io/testnet/fund   → ${receiverAddr} and ${payerAddr}`);
  console.log("  USDC : https://faucet.circle.com/  (Algorand TestNet, ASA 10458941)");

  try {
    const p = await getBalance(payerAddr);
    const r = await getBalance(receiverAddr);
    const usdc = (info) => (info.assets.find((a) => Number(a.assetId ?? a["asset-id"]) === 10458941)?.amount ?? 0) / 1e6;
    console.log("\n✔ Current balances:");
    console.log("  payer   :", `${(p.algo / 1_000_000).toFixed(4)} ALGO`, "- USDC:", usdc(p));
    console.log("  payTo   :", `${(r.algo / 1_000_000).toFixed(4)} ALGO`, "- USDC:", usdc(r));
  } catch (err) {
    console.log(`\n⚠ Could not check balances (${err.message}) — network may be down; proceed anyway.`);
  }
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});