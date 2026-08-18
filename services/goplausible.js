// GoPlausible — mock payment-orchestration / analytics client.
//
// Tracked payment events are kept in memory and (optionally) forwarded to a
// real GoPlausible endpoint when GOPLAUSIBLE_URL is configured. No external
// dependency, no network call by default — the app keeps working offline.

const events = [];

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export async function trackPayment({ service, amount, status, timestamp, txId, invoiceId, error }) {
  const event = {
    service,
    amount,
    status,
    ts: timestamp ?? Date.now(),
    txId,
    invoiceId,
    error,
  };
  events.push(event);

  const at = new Date(event.ts).toISOString().slice(11, 19);
  const line = `[GoPlausible] ${at} · ${capitalize(status)} payment for "${service}" · ${Number(amount).toFixed(4)} ALGO${txId ? ` · tx ${txId}` : ""}${error ? ` · ${error}` : ""}`;
  console.log(line);

  // Optional: forward to a real GoPlausible endpoint (opt-in via env).
  if (process.env.GOPLAUSIBLE_URL) {
    fetch(`${process.env.GOPLAUSIBLE_URL}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "payment_tracked", props: event }),
    }).catch(() => {});
  }
}

// Aggregated metrics for GET /api/metrics (in-memory).
export function getMetrics() {
  const succeeded = events.filter((e) => e.status === "success");
  const failed = events.filter((e) => e.status === "failed");

  const servicesUsed = {};
  for (const e of succeeded) {
    servicesUsed[e.service] = (servicesUsed[e.service] ?? 0) + 1;
  }

  const totalPayments = succeeded.length;
  const totalSpent = succeeded.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const successRate = totalPayments + failed.length > 0
    ? Math.round((totalPayments / (totalPayments + failed.length)) * 1000) / 10
    : 0;

  return {
    totalPayments,
    totalSpent,
    totalSpend: totalSpent, // alias used by the spec / UI
    successRate, // percent (0–100), 0 when nothing has been attempted yet
    servicesUsed,
    lastUpdated: events.length ? events[events.length - 1].ts : null,
  };
}

export default { trackPayment, getMetrics };