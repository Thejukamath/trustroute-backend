import "dotenv/config";
import algosdk from "algosdk";

const url = process.env.X402_ALGOD_URL || "https://testnet-api.algonode.cloud";
const client = new algosdk.Algodv2("", url, "");
const account = algosdk.mnemonicToSecretKey(process.env.X402_MNEMONIC);
const recipient = process.env.X402_RECIPIENT;

console.log("sender   :", account.addr.toString());
console.log("receiver :", recipient);

try {
  const params = await client.getTransactionParams().do();
  console.log("params keys:", Object.keys(params));
  console.log("firstValid:", params.firstValid.toString(), "lastValid:", params.lastValid.toString());
  console.log("fee:", params.fee.toString(), "flatFee:", params.flatFee.toString(), "minFee:", params.minFee.toString());

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: account.addr,
    receiver: recipient,
    amount: 5000n,
    note: new TextEncoder().encode("TrustRoute test"),
    suggestedParams: params,
  });
  console.log("txn fee:", txn.fee.toString());

  const signed = txn.signTxn(account.sk);
  const sent = await client.sendRawTransaction(signed).do();
  console.log("SENT txId:", sent.txId);

  // manual polling
  for (let i = 1; i <= 15; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const p = await client.pendingTransactionInformation(sent.txId).do();
      console.log(`poll ${i}: inPool=${p.poolError === ""} round=${p["last-round"]} confirmed=${p["confirmed-round"] ?? "pending"}`);
      if (p["confirmed-round"]) break;
    } catch (e) {
      console.log(`poll ${i}: error ${e.message?.slice(0, 80)}`);
    }
  }

  // check with indexer
  const idx = await fetch(`https://testnet-idx.algonode.cloud/v2/transactions/${sent.txId}`).then((r) => r.json());
  console.log("indexer:", JSON.stringify(idx).slice(0, 300));
} catch (err) {
  console.log("RAW ERROR:", err.message);
  console.log("STACK:", err.stack?.split("\n").slice(0, 3).join("\n"));
}