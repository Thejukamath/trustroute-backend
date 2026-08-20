// Opt an Algorand account into USDC (ASA 10458941, TestNet).
//   payer: node scripts/opt-in.mjs            # uses AVM_MNEMONIC / AVM_PRIVATE_KEY
//   other: node scripts/opt-in.mjs --address <addr> --mnemonic "…25 words…"
// Any held ASA requires the receiving side to be opted in too, so run this
// for BOTH the payer (client) and the payTo (server AVM_ADDRESS) accounts.

import "dotenv/config";
import algosdk from "algosdk";

const ALGOD_URL = process.env.ALGOD_URL || "https://testnet-api.algonode.cloud";
const USDC_ASA = 10458941;

let mnemonic = process.argv.find((a, i) => a === "--mnemonic") ? process.argv[process.argv.indexOf("--mnemonic") + 1] : null;
const targetAddrArg =
  process.argv.find((a) => a === "--address") ? process.argv[process.argv.indexOf("--address") + 1] : null;

let sk;
let addr;
if (process.env.AVM_PRIVATE_KEY) {
  sk = Buffer.from(process.env.AVM_PRIVATE_KEY, "base64");
  addr = algosdk.encodeAddress(sk.slice(32));
} else if (mnemonic) {
  const acc = algosdk.mnemonicToSecretKey(mnemonic);
  sk = acc.sk;
  addr = acc.addr.toString();
} else if (process.env.AVM_MNEMONIC) {
  const acc = algosdk.mnemonicToSecretKey(process.env.AVM_MNEMONIC);
  sk = acc.sk;
  addr = acc.addr.toString();
} else {
  console.error("No signing key. Set AVM_MNEMONIC / AVM_PRIVATE_KEY in server/.env or pass --mnemonic.");
  process.exit(1);
}

if (targetAddrArg) addr = targetAddrArg;

const client = new algosdk.Algodv2("", ALGOD_URL, "");
const info = await client.accountInformation(addr).do();
const optedIn = (info.assets ?? []).some((a) => Number(a["asset-id"]) === USDC_ASA);
if (optedIn) {
  console.log(`${addr} is ALREADY opted into USDC ${USDC_ASA}.`);
  process.exit(0);
}

const params = await client.getTransactionParams().do();
const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
  sender: addr,
  receiver: addr,
  amount: 0,
  assetSender: undefined,
  closeRemainderTo: undefined,
  note: Uint8Array.from(Buffer.from("TrustRoute x402 USDC opt-in")),
  assetIndex: USDC_ASA,
  suggestedParams: params,
});
const txId = txn.txID();
console.log("Opt-in tx:", txId);
console.log(`Confirm: https://testnet.explorer.perawallet.app/tx/${txId}`);
const raw = txn.signTxn(sk);
const res = await client.sendRawTransaction(raw).do();
console.log("Send response:", JSON.stringify(res).slice(0, 160));
await algosdk.waitForConfirmation(client, txId, 10);
const after = await client.accountInformation(addr).do();
const ok = (after.assets ?? []).find((a) => Number(a.assetId ?? a["asset-id"]) === USDC_ASA);
console.log(ok ? "Opt-in confirmed on-chain ✓" : "Not opted in yet (tx may still be pending).");
if (ok) console.log("USDC balance:", Number(ok.amount) / 1e6);