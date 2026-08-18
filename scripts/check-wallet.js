// Check wallet balance + payment mode without generating a new wallet.
//   npm run check-wallet

import algosdk from "algosdk";
import "dotenv/config";

const ALGOD_URL = process.env.X402_ALGOD_URL || "https://testnet-api.algonode.cloud";

const toAddr = (a) => (typeof a === "string" ? a : a.toString());

async function main() {
  if (!process.env.X402_MNEMONIC || !process.env.X402_RECIPIENT) {
    console.log("Payment mode: SIMULATED (wallet not configured)");
    console.log("Run `npm run setup-wallet` to enable REAL Algorand TestNet payments.");
    return;
  }

  const client = new algosdk.Algodv2("", ALGOD_URL, "");
  const account = algosdk.mnemonicToSecretKey(process.env.X402_MNEMONIC);
  const payerAddr = toAddr(account.addr);
  const recipientAddr = process.env.X402_RECIPIENT;

  console.log("Payment mode: REAL (Algorand TestNet)");
  console.log("Payer    :", payerAddr);
  console.log("Recipient:", recipientAddr);

  try {
    const payer = await client.accountInformation(payerAddr).do();
    const recip = await client.accountInformation(recipientAddr).do();
    console.log(`Payer balance    : ${(Number(payer.amount) / 1_000_000).toFixed(6)} ALGO`);
    console.log(`Recipient balance: ${(Number(recip.amount) / 1_000_000).toFixed(6)} ALGO`);
    if (Number(payer.amount) < 1_000_000) {
      console.log("\n⚠  Payer has < 1 ALGO — fund it:");
      console.log("   1. Open https://bank.testnet.algorand.network/");
      console.log(`   2. Paste ${payerAddr} → captcha → Send Me Algos`);
      console.log("   3. If it says 'sent', wait ~1 min, then re-run `npm run check-wallet`");
    }
  } catch (err) {
    console.log(`⚠  Balance check failed: ${err.message}`);
  }
}

main();