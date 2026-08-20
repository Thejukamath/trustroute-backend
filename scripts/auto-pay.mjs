// Unattended x402 payment waiter — polls the payer's USDC balance every 60s,
// and the instant funds appear it runs the full e2e payment, then exits.
//   node scripts/auto-pay.mjs
// Server must already be running in REAL mode (paywall target set).
import "dotenv/config";
import algosdk from "algosdk";
import { execFileSync } from "node:child_process";

const ALGOD_URL = process.env.ALGOD_URL || "https://testnet-api.algonode.cloud";
const USDC_ASA = 10458941;
const PAYER_ADDR = process.env.AVM_PRIVATE_KEY
  ? algosdk.encodeAddress(Buffer.from(process.env.AVM_PRIVATE_KEY, "base64").slice(32))
  : process.env.AVM_MNEMONIC
    ? algosdk.mnemonicToSecretKey(process.env.AVM_MNEMONIC).addr.toString()
    : null;

if (!PAYER_ADDR) {
  console.error("No payer key — set AVM_PRIVATE_KEY / AVM_MNEMONIC in server/.env");
  process.exit(1);
}

const client = new algosdk.Algodv2("", ALGOD_URL, "");
const started = Date.now();
const UPTO_MIN = 140; // a little beyond the ~2h faucet cooldown

const stamp = () => new Date().toISOString().slice(11, 19);
const usdcBalance = async () => {
  try {
    const info = await client.accountInformation(PAYER_ADDR).do();
    const a = (info.assets ?? []).find((x) => Number(x.assetId ?? x["asset-id"]) === USDC_ASA);
    return Number(a?.amount ?? 0) / 1e6;
  } catch {
    return NaN; // node hiccup — treat as "still zero", keep trying
  }
};

const log = (msg) => {
  const line = `[${stamp()}] ${msg}`;
  console.log(line);
  process.stdout.write("");
};

log(`Waiting for USDC on ${PAYER_ADDR} (up to ${UPTO_MIN} min)`);

for (let i = 0; i < UPTO_MIN; i++) {
  const bal = await usdcBalance();
  if (Number.isFinite(bal) && bal > 0) {
    log(`USDC detected: ${bal} → firing payment`);
    const out = execFileSync(process.execPath, ["scripts/e2e-x402.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    log(`PAYMENT RESULT >>>\n${out}\n<<< END`);
    log("DONE — payment attempted. Check the explorer link in the log above.");
    process.exit(0);
  }
  log(`t+${Math.round((Date.now() - started) / 60000)}m · USDC ${Number.isFinite(bal) ? bal : "?"}`);
  await new Promise((r) => setTimeout(r, 60_000));
}

log("TIMEOUT — no USDC arrived within the wait window. Re-run when the faucet allows.");
process.exit(2);