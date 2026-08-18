// Structured log entry per spec:
// { step, message, timestamp, status, service? }
// step: API_REQUEST | PAYMENT_REQUIRED | PAYMENT_SENT | PAYMENT_VERIFIED |
//       REQUEST_RETRIED | RESULT_RECEIVED | FAILOVER_TRIGGERED | PLANNING | BUDGET_CHECK

export function makeLogger() {
  let t = 0;
  const logs = [];

  const add = (step, message, status = "info", service = null, wait = 0) => {
    const entry = {
      step,
      message,
      timestamp: Math.round(t * 10) / 10,
      status,
    };
    if (service) entry.service = service;
    logs.push(entry);
    t += wait / 1000;
    return entry;
  };

  return {
    logs,
    add,
    now: () => t,
    advance: (sec) => {
      t += sec;
    },
  };
}