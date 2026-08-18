// One-command REAL payment wallet setup for TrustRoute.
//
//   npm run setup-wallet
//
// Generates a fresh TestNet payer account (sender) and a receiving account
// (service provider), writes them into server/.env, and checks the balance.
// The payer needs ALGO before payments work — fund it once:
//
//   1. copy the printed payer address
//   2. open https://bank.testnet.algorand.network/
//   3. paste address → solve captcha → Send Me Algos
//   4. re-run `npm run setup-wallet` (or just run the server) to confirm funds

import algosdk from "algosdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
const ALGOD_URL = process.env.X402_ALGOD_URL || "https://testnet-api.algonode.cloud";

async function getBalance(address) {
  const client = new algosdk.Algodv2("", ALGOD_URL, "");
  const info = await client.accountInformation(address).do();
  return Number(info.amount); // microAlgos (BigInt → Number)
}

async function main() {
  const payer = algosdk.generateAccount();
  const recipient = algosdk.generateAccount();

  const payerAddr = typeof payer.addr === "string" ? payer.addr : payer.addr.toString();
  const recipientAddr = typeof recipient.addr === "string" ? recipient.addr : recipient.addr.toString();

  const payerMnemonic = algosdk.secretKeyToMnemonic(payer.sk);
  const lines = [
    "# TrustRoute REAL payment wallet (Algorand TestNet) — do not commit this file",
    `X402_MNEMONIC="${payerMnemonic}"`,
    `X402_RECIPIENT=${recipientAddr}`,
    `X402_ALGOD_URL=${ALGOD_URL}`,
    "",
  ];

  fs.writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
  console.log("✔ Wrote server/.env");
  console.log("────────────────────────────────────────────");
  console.log("PAYER (sender)        :", payerAddr);
  console.log("RECIPIENT (provider)  :", recipientAddr);
  console.log("────────────────────────────────────────────");

  try {
    const balance = await getBalance(payerAddr);
    if (balance === 0) {
      console.log("\n⚠  Payer wallet is EMPTY — fund it before running payments:");
      console.log("   1. Open  https://bank.testnet.algorand.network/");
      console.log(`   2. Paste ${payerAddr}`);
      console.log("   3. Solve the captcha → Send Me Algos (you may need to retry)");
      console.log("   4. Re-run this script or start the server — mode will be REAL");
    } else {
      console.log(`\n✔ Payer balance: ${(balance / 1_000_000).toFixed(4)} ALGO — ready for REAL payments`);
    }
    console.log("Recipient balance     :", `${(await getBalance(recipientAddr)) / 1_000_000} ALGO`);
  } catch (err) {
    console.log(`\n⚠ Could not check balances (${err.message}) — network may be down; proceed anyway.`);
  }
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});