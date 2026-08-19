// Rule-based decision engine — selects services for a task.
//
// Two modes:
//   · single task   → one category, its services
//   · multi task    → "weather in Bangalore and stock price of ethereum"
//                     splits on "and/then/also", each intent gets its own
//                     category, services are the union. The plan exposes
//                     `multi: true` and `categories[]` so the UI can log
//                     "Multi-task detected → executing weather + finance"
//                     and render a separate ## section per category.

import { CATALOG } from "../services/catalog.js";

const RULES = [
  // Order matters: more specific categories are checked FIRST so a
  // task like "What is the weather in Mysore?" routes to Weather,
  // not to generic Research/News.
  {
    id: "weather",
    keywords: ["weather", "temperature", "forecast", "rain", "humidity", "sunny", "cloudy", "climate"],
    services: ["weather"],
  },
  {
    id: "finance",
    keywords: ["stock", "stocks", "price", "crypto", "bitcoin", "btc", "ethereum", "eth", "finance", "share", "shares", "ticker", "market"],
    services: ["finance"],
  },
  {
    id: "code",
    keywords: ["code", "coding", "program", "programming", "app", "debug", "function", "script", "fix bug", "review code", "implement", "build", "api endpoint", "typescript"],
    services: ["code", "review"],
  },
  {
    id: "write",
    keywords: ["write", "writing", "content", "copy", "blog", "article", "essay", "email", "draft", "poem", "story", "caption"],
    services: ["writing", "grammar"],
  },
  {
    // News gets its OWN rule so a pure "news" task never pulls in research.
    id: "news",
    keywords: ["news", "headline", "headlines", "breaking", "latest"],
    services: ["news"],
  },
  {
    // Research is free of news keywords — it answers queries, analysis and
    // explanations ("explain quantum computing" → research only).
    id: "research",
    keywords: ["research", "explain", "define", "search", "investigate", "analyze", "analyse", "summarize", "summarise", "deep dive", "study", "how does", "what is", "what are"],
    services: ["research"],
  },
];

const FALLBACK = { id: "general", keywords: [], services: ["research"] };

const GENERAL_ID = "general";

// First rule whose keyword appears in the task wins.
export function matchCategory(task) {
  const t = task.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((k) => t.includes(k))) return rule;
  }
  return FALLBACK;
}

// Multi-intent detection: split on "and / then / also". A task only counts
// as multi when AT LEAST TWO parts hit a real (non-general) category, so
// "news about AI and payments" stays one news task instead of splitting
// into an artificial second intent.
export function detectIntents(task) {
  const parts = task
    .split(/\s+(?:and|then|also)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const matched = parts
    .map((part) => ({ part, rule: matchCategory(part) }))
    .filter((m) => m.rule.id !== GENERAL_ID);

  return matched.length >= 2 ? matched : null;
}

// service id → the rule that provides it (used to tag each plan service
// with its own category so the UI can build per-category sections).
const SERVICE_CATEGORY = new Map();
for (const rule of RULES) {
  for (const sid of rule.services) {
    if (!SERVICE_CATEGORY.has(sid)) SERVICE_CATEGORY.set(sid, rule.id);
  }
}

export function orderServices(ids, priority) {
  const list = ids.map((id) => CATALOG[id]).filter(Boolean);
  if (priority === "Cost") list.sort((a, b) => a.cost - b.cost);
  else if (priority === "Reliability") list.sort((a, b) => b.reliability - a.reliability);
  else list.sort((a, b) => a.latency - b.latency);
  return list;
}

// Rule-based plan: single/multi detection + priority ordering + budget guard.
export function buildPlan(task, budget, priority) {
  const multi = detectIntents(task);
  let category;
  let categories;
  let services;
  let reasoning;

  if (multi) {
    category = "multi";
    categories = multi.map((m) => m.rule.id);
    const ids = [...new Set(multi.flatMap((m) => m.rule.services))];
    services = orderServices(ids, priority);
    reasoning = [
      `Multi-task detected: ${multi.map((m) => `"${m.part}" → ${m.rule.id}`).join(" · ")}`,
      `Selected services: ${services.map((s) => s.name).join(", ")}`,
      `Ordered by ${priority.toLowerCase()} priority`,
    ];
  } else {
    const rule = matchCategory(task);
    category = rule.id;
    categories = [rule.id];
    services = orderServices(rule.services, priority);
    reasoning = [
      `Matched category "${category}" via keyword analysis of the task`,
      `Selected services: ${services.map((s) => s.name).join(", ")}`,
      `Ordered by ${priority.toLowerCase()} priority`,
    ];
  }

  const estimate = Math.round(services.reduce((s, c) => s + c.cost, 0) * 1000) / 1000;

  reasoning.push(
    estimate > budget
      ? `Budget guard: estimated ${estimate} exceeds available ${budget} — task may be trimmed`
      : `Budget guard: estimated ${estimate} within available ${budget}`
  );

  const confidence = Math.round(
    (services.reduce((s, c) => s + c.reliability, 0) / services.length) * 100
  );

  return {
    category,
    categories,
    multi: Boolean(multi),
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      category: SERVICE_CATEGORY.get(s.id) ?? category,
      cost: s.cost,
      reliability: s.reliability,
      latency: s.latency,
      primary: s.primary,
      backup: s.backup,
    })),
    estimate,
    reasoning,
    confidence,
    budgetExceeded: estimate > budget,
  };
}