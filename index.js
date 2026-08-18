// TrustRoute — Autonomous AI Service Payments (Hybrid Real + Simulation)
// Express API: real x402 endpoint + simulated providers + rule-based agent.

import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import researchRouter from "./routes/research.js";
import servicesRouter from "./routes/services.js";
import planRouter from "./routes/plan.js";
import payRouter from "./routes/pay.js";
import txRouter from "./routes/tx.js";
import metricsRouter from "./routes/metrics.js";
import { getPaymentMode } from "./payment/x402Handler.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    status: "all systems operational",
    network: "Algorand TestNet",
    protocol: "x402",
    mode: getPaymentMode(),
  });
});

// ── API surface ──────────────────────────────────────────────────────────────
app.use("/api/plan", planRouter); //     agent decision engine
app.use("/api/research", researchRouter); // REAL x402 endpoint
app.use("/api/services", servicesRouter); // simulated x402 services
app.use("/api/pay", payRouter); //        payment trigger (x402Handler)
app.use("/api/tx", txRouter); //          transaction verification lookup
app.use("/api/metrics", metricsRouter); // GoPlausible payment analytics

// ── production: serve the built client ───────────────────────────────────────
const dist = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`TrustRoute server running on http://localhost:${PORT}`);
  console.log("POST /api/plan · POST /api/research (REAL x402) · POST /api/services/:id · POST /api/pay · GET /api/tx/:txId");
  const mode = getPaymentMode();
  console.log(`Payment layer: ${mode.mode.toUpperCase()} — ${mode.reason}`);
  if (mode.mode === "simulated") {
    console.log("Tip: `npm run setup-wallet` in server/ enables REAL Algorand TestNet payments.");
  }
});