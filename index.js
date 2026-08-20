// TrustRoute — Autonomous AI Service Payments (real x402 on Algorand TestNet)
// Express API: real x402 paywall + real provider APIs + rule-based agent.

import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import researchRouter from "./routes/research.js";
import servicesRouter from "./routes/services.js";
import planRouter from "./routes/plan.js";
import metricsRouter from "./routes/metrics.js";
import agentRouter from "./routes/agent.js";
import { x402PaymentMiddleware, getX402Status } from "./x402/paywall.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;

app.use(
  cors({
    origin: true,
    credentials: true,
    // CORS must expose the x402 headers so the browser can read them.
    exposedHeaders: [
      "PAYMENT-REQUIRED",
      "PAYMENT-SIGNATURE",
      "PAYMENT-RESPONSE",
      "X-PAYMENT",
      "X-PAYMENT-RESPONSE",
    ],
  })
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    status: "all systems operational",
    protocol: "x402",
    x402: getX402Status(),
  });
});

// ── x402 payment wall — guards /api/research + /api/services/* ──────────────
app.use(x402PaymentMiddleware);

// ── API surface ──────────────────────────────────────────────────────────────
app.use("/api/plan", planRouter); //     free agent decision engine
app.use("/api/research", researchRouter); // $0.05 paywalled research endpoint
app.use("/api/services", servicesRouter); // $0.02 paywalled service endpoints
app.use("/api/metrics", metricsRouter); // GoPlausible payment analytics
app.use("/api/run-agent", agentRouter); //  smart engine: classify → score → failover

// ── production: serve the built client ───────────────────────────────────────
const dist = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`TrustRoute server running on http://localhost:${PORT}`);
  console.log("Routes: POST /api/plan (free) · POST /api/research · POST /api/services/:id (x402 paywalled) · GET /api/metrics");
  const status = getX402Status();
  if (status.mode === "real") {
    console.log(
      `x402 PAYWALL: real — ${status.networkLabel} · USDC ASA ${status.asset} · payTo ${status.payTo} · facilitator ${status.facilitator}`
    );
  } else {
    console.log(
      "x402 PAYWALL: unconfigured — set AVM_ADDRESS in server/.env (see .env.example). Paid routes return 503."
    );
  }
});