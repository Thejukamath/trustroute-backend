// Rule-based decision engine — selects services for a task.

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
    keywords: ["code", "program", "app", "debug", "function", "script", "fix bug", "review code", "implement", "build", "api endpoint", "typescript"],
    services: ["code", "review"],
  },
  {
    id: "write",
    keywords: ["write", "writing", "content", "copy", "blog", "article", "essay", "email", "draft", "poem", "story", "caption"],
    services: ["writing", "grammar"],
  },
  {
    id: "research",
    keywords: ["research", "search", "find", "investigate", "trend", "market", "analyze", "analyse", "news", "deep dive", "study"],
    services: ["research", "news"],
  },
];

const FALLBACK = { id: "general", keywords: [], services: ["research"] };

export function matchCategory(task) {
  const t = task.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((k) => t.includes(k))) return rule;
  }
  return FALLBACK;
}

export function orderServices(ids, priority) {
  const list = ids.map((id) => CATALOG[id]);
  if (priority === "Cost") list.sort((a, b) => a.cost - b.cost);
  else if (priority === "Reliability") list.sort((a, b) => b.reliability - a.reliability);
  else list.sort((a, b) => a.latency - b.latency);
  return list;
}

// Rule-based plan: category match + priority ordering + budget guard.
export function buildPlan(task, budget, priority) {
  const category = matchCategory(task);
  const services = orderServices(category.services, priority);
  const estimate = Math.round(services.reduce((s, c) => s + c.cost, 0) * 1000) / 1000;

  const reasoning = [
    `Matched category "${category.id}" via keyword analysis of the task`,
    `Selected services: ${services.map((s) => s.name).join(", ")}`,
    `Ordered by ${priority.toLowerCase()} priority`,
    estimate > budget
      ? `Budget guard: estimated ${estimate} exceeds available ${budget} — task may be trimmed`
      : `Budget guard: estimated ${estimate} within available ${budget}`,
  ];

  const confidence = Math.round(
    (services.reduce((s, c) => s + c.reliability, 0) / services.length) * 100
  );

  return {
    category: category.id,
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
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