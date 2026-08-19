// ─────────────────────────────────────────────────────────────────────────────
// TrustRoute — Smart Agent Engine
//
//   classifyTask(task)        → pick a category (weather / news / finance /
//                                research / writing / general)
//   scoreService(service, p)  → score for a priority (cheapest / fastest /
//                                reliable / balanced)
//   selectServices(...)       → services of the category, ranked by score
//   isBadResponse(text)       → true when an answer is a refusal or too short
//   callWithFailover(...)     → try services in ranked order until one returns
//                                a VALID result (API error or bad response →
//                                move to the next candidate)
//   runAgent(...)             → orchestrator: splits "a and b" tasks, runs each
//                                step through callWithFailover
//
// Pure JavaScript, no ML, no dependencies. All actual service calls go through
// the provider layer (services/providers.js), which already handles real API
// chains + simulated fallbacks.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchProvider } from "../services/providers.js";

// ─── 1. SERVICE REGISTRY ─────────────────────────────────────────────────────
// One flat list: every candidate service + its properties.
//   cost        → ALGO per call (what we pay via x402)
//   speed       → 1 (slow) … 10 (fast)
//   reliability → 1 (flaky) … 10 (rock solid)

export const SERVICE_REGISTRY = [
  { id: "weather", name: "WeatherAPI", category: "weather", cost: 0.001, speed: 9, reliability: 9 },
  { id: "news", name: "NewsAPI", category: "news", cost: 0.004, speed: 8, reliability: 9 },
  { id: "finance", name: "FinanceAPI", category: "finance", cost: 0.002, speed: 8, reliability: 8 },
  { id: "research", name: "Gemini Research", category: "research", cost: 0.005, speed: 6, reliability: 8 },
  { id: "wikipedia", name: "Wikipedia Research", category: "research", cost: 0, speed: 7, reliability: 6 },
  { id: "writing", name: "WritingAPI", category: "writing", cost: 0.008, speed: 5, reliability: 7 },
];

// ─── 2. TASK CLASSIFICATION ──────────────────────────────────────────────────
// Keyword lists per category. "general" is the fallback for anything else.

const CATEGORY_KEYWORDS = {
  weather: ["weather", "temperature", "forecast", "rain", "humidity", "sunny", "cloudy", "wind"],
  news: ["news", "headlines", "breaking", "latest", "top stories"],
  finance: [
    "stock", "stocks", "price of", "crypto", "bitcoin", "btc", "ethereum", "eth",
    "finance", "share", "shares", "ticker", "usd", "market value",
  ],
  research: [
    "explain", "analysis", "analyse", "research", "what is", "who is", "why does",
    "how does", "information about", "details about", "summary of", "semiconductor",
  ],
  writing: ["write", "generate", "draft", "email", "blog", "story", "poem", "essay", "caption", "content"],
};

export function classifyTask(task) {
  const t = String(task).toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((k) => t.includes(k))) return category;
  }
  return "general";
}

// ─── 3. PRIORITY-BASED SCORING ───────────────────────────────────────────────
// Higher score = better match. Cost is inverted (cheap → high score) so every
// axis is "bigger is better" and can be averaged fairly.

const MAX_COST = Math.max(...SERVICE_REGISTRY.map((s) => s.cost));

function costScore(service) {
  // cheapest service → 10, most expensive → 1
  return 10 - (service.cost / MAX_COST) * 9;
}

export function scoreService(service, priority) {
  switch (String(priority).toLowerCase()) {
    case "cheapest":
    case "cost":
      return costScore(service);
    case "fastest":
    case "speed":
      return service.speed;
    case "reliable":
    case "reliability":
      return service.reliability;
    case "balanced":
    default:
      return (costScore(service) + service.speed + service.reliability) / 3;
  }
}

// ─── 4. SERVICE SELECTION ────────────────────────────────────────────────────
// Filter by category (+ budget), sort by score descending, return ranked list.
// selectService() returns just the best one.

export function selectServices(task, priority = "balanced", budget = Infinity) {
  const category = classifyTask(task);
  return SERVICE_REGISTRY.filter(
    (s) => s.category === category && s.cost <= budget
  ).sort((a, b) => scoreService(b, priority) - scoreService(a, priority));
}

export function selectService(task, priority = "balanced", budget = Infinity) {
  const ranked = selectServices(task, priority, budget);
  return ranked.length ? ranked[0] : null;
}

// ─── 5. SMART FAILOVER ───────────────────────────────────────────────────────

// An API can return HTTP 200 but still fail to answer — either it refuses
// ("cannot provide…") or it returns something useless (empty / too short).
const BAD_PATTERNS = [
  "cannot provide",
  "do not have access",
  "not available",
  "unable to",
  "i cannot",
  "i'm sorry",
  "i am sorry",
  "as an ai",
  "cannot assist",
  "no data",
];

const MIN_VALID_LENGTH = 20; // anything shorter is not a real answer

export function isBadResponse(response) {
  if (typeof response !== "string" || !response.trim()) return true;
  const text = response.toLowerCase();
  if (text.length < MIN_VALID_LENGTH) return true; // too short
  return BAD_PATTERNS.some((p) => text.includes(p));
}

// Simple console logger that matches the provider layer's `logs.add` shape.
const consoleLogger = {
  add: (step, message, status) =>
    console.log(`[agent]   ${String(status).toUpperCase().padEnd(7)} ${step}: ${message}`),
};

// Try every service of the category, best-ranked first. Each attempt:
//   1. call the provider chain for that service
//   2. if it throws (API down, no key, timeout) → log, try next
//   3. if it returns a "bad response" (refusal / too short) → log, try next
//   4. otherwise → we are done, return the valid result
export async function callWithFailover(task, priority = "balanced", budget = Infinity) {
  const category = classifyTask(task);
  const ranked = selectServices(task, priority, budget);
  console.log(`[agent] category="${category}" · candidates: ${ranked.map((s) => s.name).join(" > ")}`);

  if (ranked.length === 0) {
    console.warn(`[agent] no service fits category "${category}" within budget ${budget}`);
    return { success: false, error: `No service available for "${category}" within the budget`, attempts: [] };
  }

  const attempts = [];
  let providerFailover = false;

  for (const svc of ranked) {
    const t0 = Date.now();
    const attempt = { service: svc.name, cost: svc.cost, status: "trying" };

    try {
      // provider chain internally fails over between real APIs (Gemini →
      // OpenAI → …) and the simulator is the last resort
      const out = await fetchProvider(svc.id, task, consoleLogger, () => {
        providerFailover = true;
      });

      if (isBadResponse(out.payload)) {
        attempt.status = "bad_response";
        attempt.reason = out.payload.slice(0, 80);
        console.warn(`[agent] ${svc.name} returned a bad response → trying next`);
      } else {
        attempt.status = "ok";
        attempt.provider = out.provider;
        attempt.ms = out.ms;
        console.log(`[agent] ${svc.name} (${out.provider}) answered in ${out.ms}ms`);
        return {
          success: true,
          category,
          service: svc,
          result: out.payload,
          latencyMs: out.ms,
          usedFailover: attempts.length > 0 || providerFailover,
          attempts: [...attempts, attempt],
        };
      }
    } catch (err) {
      attempt.status = "error";
      attempt.reason = String(err.message).slice(0, 80);
      console.error(`[agent] ${svc.name} failed (${attempt.reason}) → trying next`);
    }

    attempts.push({ ...attempt, ms: Date.now() - t0 });
  }

  console.error(`[agent] all ${ranked.length} candidate(s) failed`);
  return {
    success: false,
    category,
    error: "All candidate services failed",
    attempts,
  };
}

// ─── 6. ORCHESTRATOR (multi-step bonus) ──────────────────────────────────────
// "What is the weather in Bangalore and stock price of bitcoin" is split on
// " and " → each sub-task is classified, scored and executed independently.

export async function runAgent(task, priority = "balanced", budget = Infinity) {
  const steps = String(task)
    .split(/\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const results = [];
  let usedFailover = false;

  for (const step of steps) {
    console.log(`[agent] ── step: "${step}"`);
    const outcome = await callWithFailover(step, priority, budget);
    usedFailover = usedFailover || outcome.usedFailover;
    results.push(outcome);
  }

  return {
    task,
    steps,
    priority,
    budget,
    usedFailover,
    results,
  };
}
