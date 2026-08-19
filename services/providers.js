// Provider layer — real APIs with failover chains, plus a simulated fallback.
//
// Every service has a provider chain:
//   weather:   OpenWeather (primary) → WeatherAPI.com (backup) → simulated
//   news:      GNews (primary) → NewsAPI.org (backup) → simulated
//   research:  Google Gemini (primary) → OpenAI → Anthropic Claude →
//              Wikipedia (free, no key) → simulated
//   writing:   Google Gemini (primary) → OpenAI → Anthropic Claude → simulated
//   grammar / code / review: simulated
//
// Real providers fail naturally (missing API key, network error, HTTP error).
// If the primary fails → "Failover triggered — switching provider" is logged
// and the next provider in the chain is tried. Set DEMO_FAILOVER=1 to force
// the primary provider to fail once, so the failover path is always visible
// in a demo. The simulated provider is always last, so the app keeps working
// without any API keys (hackathon mode). Wikipedia sits just above the
// simulator: it needs NO API key, so "custom" questions (e.g. "information
// about semiconductors") get a REAL, topic-specific answer even on a fresh
// deployment — the simulator is only reached when Wikipedia has no article.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEMO_FAILOVER = process.env.DEMO_FAILOVER === "1";
// LLM endpoints (Gemini et al.) can take 20–30s+ even without thinking — the
// overall budget must exceed the slowest provider, or failover would trigger
// on latency rather than real failure.
const REQ_TIMEOUT_MS = 60_000;

async function httpJson(url, { method = "GET", headers = {}, body = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQ_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function extractCity(task) {
  let m = task.match(/(?:^|\s)(?:in|for|at)\s+([A-Za-z][A-Za-z\s-]{1,40})$/i);
  if (m) return m[1].trim();
  m = task.match(/(?:weather|forecast|temperature)\s+(?:in|for|at)\s+([A-Za-z][A-Za-z\s-]{1,40})/i);
  if (m) return m[1].trim();
  return "London";
}

function extractQuery(task) {
  let m = task.match(/news\s+(?:about|on|regarding|for)\s+(.*)/i);
  if (m && m[1]) return m[1].trim();
  return task;
}

// ── weather providers ────────────────────────────────────────────────────────

async function openWeather(task) {
  const key = process.env.OPENWEATHER_API_KEY;
  const city = encodeURIComponent(extractCity(task));
  const data = await httpJson(
    `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${key}&units=metric`
  );
  return {
    text:
      `Weather briefing for ${data.name} (via OpenWeather API)\n\n` +
      `• Temperature: ${data.main.temp}°C (feels like ${data.main.feels_like}°C)\n` +
      `• Condition: ${data.weather?.[0]?.description}\n` +
      `• Humidity: ${data.main.humidity}% · Pressure: ${data.main.pressure} hPa\n` +
      `• Wind: ${data.wind?.speed} m/s\n` +
      `• Sunrise ${new Date(data.sys.sunrise * 1000).toLocaleTimeString()} · Sunset ${new Date(data.sys.sunset * 1000).toLocaleTimeString()}`,
  };
}

async function weatherApiCom(task) {
  const key = process.env.WEATHERAPI_KEY;
  const city = encodeURIComponent(extractCity(task));
  const data = await httpJson(
    `https://api.weatherapi.com/v1/current.json?key=${key}&q=${city}`
  );
  const c = data.current;
  return {
    text:
      `Weather briefing for ${data.location.name}, ${data.location.country} (via WeatherAPI.com)\n\n` +
      `• Temperature: ${c.temp_c}°C (feels like ${c.feelslike_c}°C)\n` +
      `• Condition: ${c.condition.text}\n` +
      `• Humidity: ${c.humidity}%\n` +
      `• Wind: ${c.wind_kph} km/h · UV index ${c.uv}\n` +
      `• Last updated: ${c.last_updated}`,
  };
}

// ── news providers ───────────────────────────────────────────────────────────

async function gnews(task) {
  const key = process.env.GNEWS_API_KEY;
  const q = encodeURIComponent(extractQuery(task));
  const data = await httpJson(
    `https://gnews.io/api/v4/search?q=${q}&apikey=${key}&lang=en&max=3`
  );
  const articles = (data.articles || []).slice(0, 3);
  if (!articles.length) throw new Error("No articles returned");
  return {
    text:
      `Top 3 headlines for "${extractQuery(task)}" (via GNews API)\n\n` +
      articles
        .map(
          (a, i) =>
            `${i + 1}. ${a.title}\n   ${(a.description || "").slice(0, 160)}\n   ${a.source?.name || "news"} — ${a.publishedAt || ""}`
        )
        .join("\n"),
  };
}

async function newsApi(task) {
  const key = process.env.NEWSAPI_KEY || process.env.NEWS_API_KEY;
  const q = encodeURIComponent(extractQuery(task));
  const data = await httpJson(
    `https://newsapi.org/v2/everything?q=${q}&apiKey=${key}&pageSize=3&language=en&sortBy=publishedAt`
  );
  const articles = (data.articles || []).slice(0, 3);
  if (!articles.length) throw new Error("No articles returned");
  return {
    text:
      `Top 3 headlines for "${extractQuery(task)}" (via NewsAPI.org)\n\n` +
      articles
        .map(
          (a, i) =>
            `${i + 1}. ${a.title}\n   ${(a.description || "").slice(0, 160)}\n   ${a.source?.name || "news"} — ${new Date(a.publishedAt).toLocaleDateString()}`
        )
        .join("\n"),
  };
}

// ── finance providers (crypto + stocks, no API key required) ─────────────────

// "bitcoin price" / "btc" / "ethereum" → CoinGecko ids; company names → Stooq tickers.
const CRYPTO_SYMBOLS = {
  btc: "bitcoin",
  bitcoin: "bitcoin",
  eth: "ethereum",
  ethereum: "ethereum",
  doge: "dogecoin",
  dogecoin: "dogecoin",
  sol: "solana",
  solana: "solana",
  xrp: "ripple",
  ripple: "ripple",
  ada: "cardano",
  cardano: "cardano",
  algo: "algorand",
  algorand: "algorand",
};

const COMPANY_TICKERS = {
  apple: "aapl.us",
  tesla: "tsla.us",
  nvidia: "nvda.us",
  microsoft: "msft.us",
  google: "googl.us",
  amazon: "amzn.us",
  meta: "meta.us",
  netflix: "nflx.us",
};

function extractFinSymbol(task) {
  const t = task.toLowerCase();
  for (const [key, id] of Object.entries(CRYPTO_SYMBOLS)) {
    if (t.includes(key)) return { kind: "crypto", id };
  }
  for (const [key, ticker] of Object.entries(COMPANY_TICKERS)) {
    if (t.includes(key)) return { kind: "stock", ticker };
  }
  return null;
}

async function coinGecko(task) {
  const hit = extractFinSymbol(task);
  if (!hit || hit.kind !== "crypto") throw new Error("No crypto symbol found in task");
  const data = await httpJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${hit.id}&vs_currencies=usd`
  );
  const price = data[hit.id]?.usd;
  if (price == null) throw new Error("CoinGecko returned no price");
  const name = hit.id.charAt(0).toUpperCase() + hit.id.slice(1);
  return {
    text:
      `Crypto price for ${name} (via CoinGecko)\n\n` +
      `• Price: $${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}\n` +
      `• Query: "${task}"`,
  };
}

async function stooq(task) {
  const hit = extractFinSymbol(task);
  if (!hit || hit.kind !== "stock") throw new Error("No stock symbol found in task");
  const res = await fetch(
    `https://stooq.com/q/l/?s=${hit.ticker}&f=sd2t2ohlcv&h&e=csv`,
    { signal: AbortSignal.timeout(REQ_TIMEOUT_MS) }
  );
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);
  const csv = await res.text(); // Symbol,Date,Time,Open,High,Low,Close,Volume
  const line = (csv.trim().split("\n").pop() || "").split(",");
  const close = line[5];
  const date = line[1];
  if (!close || close === "N/D") throw new Error("Stooq returned no data");
  return {
    text:
      `Stock price for ${hit.ticker.toUpperCase()} (via Stooq)\n\n` +
      `• Close: $${close} on ${date}\n` +
      `• Query: "${task}"`,
  };
}

// ── LLM providers (research + writing) ───────────────────────────────────────

const RESEARCH_SYSTEM =
  "You are a senior research analyst. Answer concisely with key findings, " +
  "bullet points, sources, and a confidence estimate. Under 400 words.";

const WRITING_SYSTEM =
  "You are a professional copywriter. Produce structured, polished content " +
  "for the given brief: headline, 3 short sections, and a CTA. Under 350 words.";

async function openaiChat(system, task, maxTokens) {
  const data = await httpJson("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: {
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: task },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    },
  });
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty completion from OpenAI");
  return text.trim();
}

async function anthropicChat(system, task, maxTokens) {
  const data = await httpJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: {
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: task }],
    },
  });
  const text = data.content?.[0]?.text;
  if (!text) throw new Error("Empty completion from Anthropic");
  return text.trim();
}

async function geminiChat(system, task, maxTokens) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const data = await httpJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: {
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: task }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.7,
          // Lite models don't accept thinkingConfig; the full flash line
          // thinks by default, so pin the budget to 0 for speed + clean text.
          ...(model.includes("lite")
            ? {}
            : { thinkingConfig: { thinkingBudget: 0 } }),
        },
      },
    }
  );
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty completion from Gemini");
  return text.trim();
}

// ── free encyclopedic provider (no API key required) ─────────────────────────

// Turn "information about semiconductors" / "what is X" / "tell me about X"
// into a plain topic title ("Semiconductors").
function extractTopic(task) {
  let t = task.trim().replace(/[?.!]+$/, "");
  t = t.replace(/^(?:information|info|details|facts|summary)\s+(?:about|on|regarding)\s+/i, "");
  t = t.replace(/^(?:tell me|give me|get|show)\s+(?:me\s+)?(?:some\s+)?(?:information|info|details|facts)?\s*(?:about|on|regarding)\s+/i, "");
  t = t.replace(/^(?:what|who|where|when|why|how)\s+(?:is|are|was|were)\s+/i, "");
  t = t.replace(/^(?:the|latest|current|recent)\s+/i, "");
  return t.trim() || task.trim();
}

async function wikipedia(task) {
  const topic = encodeURIComponent(extractTopic(task));
  const data = await httpJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${topic}`, {
    headers: { "User-Agent": "TrustRoute/1.0" },
  });
  if (!data.extract) throw new Error("No article found");
  return {
    text:
      `Encyclopedic summary for "${data.title}" (via Wikipedia)\n\n` +
      data.extract +
      `\n\nSource: ${data.content_urls?.desktop?.page ?? "https://en.wikipedia.org"}`,
  };
}

// ── simulated fallbacks (no keys / final fallback) ───────────────────────────

const SIM_RESULTS = {
  research: (task) =>
    `Research complete — 3 primary sources verified and 11 secondary references cross-checked.\n` +
    `Question: "${task}"\n\n` +
    `Key findings:\n` +
    `• 2 notable developments identified in the last 30 days\n` +
    `• Upstream demand estimated to grow +18% YoY\n` +
    `• 1 source flagged low-credibility and deprioritized\n` +
    `• Multi-source agreement: 92%\n\n` +
    `Simulated provider — add OPENAI_API_KEY to route this through a real LLM.`,
  news: (task) =>
    `News digest for: "${task}"\n\n` +
    `• Top story: Consortium unveils open standard for AI agent payments\n` +
    `• 3 outlets report fresh momentum around x402-style micropayments\n` +
    `• Sentiment: positive (7/8 articles); correction risk noted in 1 piece\n\n` +
    `Simulated provider — add GNEWS_API_KEY for live headlines.`,
  writing: (task) =>
    `Draft complete for: "${task}"\n\n` +
    `• 3 variants produced (formal, casual, punchy) — best match selected\n` +
    `• Tone calibrated for clarity and persuasion\n` +
    `• Reading time ≈ 1 min 40 s\n\n` +
    `Simulated provider — add OPENAI_API_KEY for live generation.`,
  grammar: (task) =>
    `Grammar scan on: "${task}"\n\n` +
    `• 0 errors found, 2 style suggestions applied\n` +
    `• Readability score: 74 (clear)\n` +
    `• Passive voice reduced to 8%`,
  code: (task) =>
    `Implementation for: "${task}"\n\n` +
    `• ~240 lines written (TypeScript)\n` +
    `• 4 edge cases handled (nulls, empty payloads, timeouts, large batches)\n` +
    `• Unit tests: 12/12 green\n\n` +
    `Patch attached as a diff with a commit message.`,
  review: (task) =>
    `Code review verdict on: "${task}"\n\n` +
    `• PASS — 0 blockers, 1 nit\n` +
    `• Cyclomatic complexity within threshold\n` +
    `• 8/8 lint rules satisfied`,
  weather: (task) =>
    `Weather briefing for: "${extractCity(task)}"\n\n` +
    `• Current: 18°C, partly cloudy, humidity 62%\n` +
    `• +4°C swing expected by Thursday\n` +
    `• Precipitation risk: 20% this weekend\n` +
    `• Sunrise 06:42 · Sunset 20:15\n\n` +
    `Simulated provider — add OPENWEATHER_API_KEY for live conditions.`,
  finance: (task) =>
    `Market update for: "${task}"\n\n` +
    `• BTC ≈ $67,400 (+2.1% · 24h)\n` +
    `• S&P 500 +0.4% · VIX within normal range\n` +
    `• 3 analysts flag a pullback; momentum indicators mixed\n\n` +
    `Simulated provider — CoinGecko/Stooq are free and need no key.`,
};

// ── provider chains ──────────────────────────────────────────────────────────

const CHAINS = {
  research: [
    {
      name: "Google Gemini",
      display: "generativelanguage.googleapis.com/v1beta/models/gemini:generateContent",
      real: true,
      ready: () => Boolean(process.env.GEMINI_API_KEY),
      run: (task) => geminiChat(RESEARCH_SYSTEM, task, 900),
    },
    {
      name: "OpenAI",
      display: "api.openai.com/v1/chat/completions",
      real: true,
      ready: () => Boolean(process.env.OPENAI_API_KEY),
      run: (task) => openaiChat(RESEARCH_SYSTEM, task, 420),
    },
    {
      name: "Anthropic Claude",
      display: "api.anthropic.com/v1/messages",
      real: true,
      ready: () => Boolean(process.env.ANTHROPIC_API_KEY),
      run: (task) => anthropicChat(RESEARCH_SYSTEM, task, 420),
    },
    {
      name: "Wikipedia",
      display: "en.wikipedia.org/api/rest_v1/page/summary",
      real: true,
      ready: () => true, // free, no key needed
      run: wikipedia,
    },
    {
      name: "Research (simulated)",
      display: "simulated-provider.x402.dev",
      real: false,
      ready: () => true,
      run: (task) => ({ text: SIM_RESULTS.research(task) }),
    },
  ],
  // standalone Wikipedia chain for the engine's "Wikipedia Research" service
  wikipedia: [
    {
      name: "Wikipedia",
      display: "en.wikipedia.org/api/rest_v1/page/summary",
      real: true,
      ready: () => true,
      run: wikipedia,
    },
    {
      name: "Research (simulated)",
      display: "simulated-provider.x402.dev",
      real: false,
      ready: () => true,
      run: (task) => ({ text: SIM_RESULTS.research(task) }),
    },
  ],
  news: [
    {
      name: "GNews",
      display: "gnews.io/api/v4/search",
      real: true,
      ready: () => Boolean(process.env.GNEWS_API_KEY),
      run: gnews,
    },
    {
      name: "NewsAPI.org",
      display: "newsapi.org/v2/everything",
      real: true,
      ready: () => Boolean(process.env.NEWSAPI_KEY || process.env.NEWS_API_KEY),
      run: newsApi,
    },
    {
      name: "News (simulated)",
      display: "simulated-provider.x402.dev",
      real: false,
      ready: () => true,
      run: (task) => ({ text: SIM_RESULTS.news(task) }),
    },
  ],
  writing: [
    {
      name: "Google Gemini",
      display: "generativelanguage.googleapis.com/v1beta/models/gemini:generateContent",
      real: true,
      ready: () => Boolean(process.env.GEMINI_API_KEY),
      run: (task) => geminiChat(WRITING_SYSTEM, task, 900),
    },
    {
      name: "OpenAI",
      display: "api.openai.com/v1/chat/completions",
      real: true,
      ready: () => Boolean(process.env.OPENAI_API_KEY),
      run: (task) => openaiChat(WRITING_SYSTEM, task, 380),
    },
    {
      name: "Anthropic Claude",
      display: "api.anthropic.com/v1/messages",
      real: true,
      ready: () => Boolean(process.env.ANTHROPIC_API_KEY),
      run: (task) => anthropicChat(WRITING_SYSTEM, task, 380),
    },
    {
      name: "Writing (simulated)",
      display: "simulated-provider.x402.dev",
      real: false,
      ready: () => true,
      run: (task) => ({ text: SIM_RESULTS.writing(task) }),
    },
  ],
  weather: [
    {
      name: "OpenWeather",
      display: "api.openweathermap.org/data/2.5/weather",
      real: true,
      ready: () => Boolean(process.env.OPENWEATHER_API_KEY),
      run: openWeather,
    },
    {
      name: "WeatherAPI.com",
      display: "api.weatherapi.com/v1/current.json",
      real: true,
      ready: () => Boolean(process.env.WEATHERAPI_KEY),
      run: weatherApiCom,
    },
    {
      name: "Weather (simulated)",
      display: "simulated-provider.x402.dev",
      real: false,
      ready: () => true,
      run: (task) => ({ text: SIM_RESULTS.weather(task) }),
    },
  ],
  finance: [
    {
      name: "CoinGecko",
      display: "api.coingecko.com/api/v3/simple/price",
      real: true,
      ready: () => true,
      run: coinGecko,
    },
    {
      name: "Stooq",
      display: "stooq.com/q/l/",
      real: true,
      ready: () => true,
      run: stooq,
    },
    {
      name: "Finance (simulated)",
      display: "simulated-provider.x402.dev",
      real: false,
      ready: () => true,
      run: (task) => ({ text: SIM_RESULTS.finance(task) }),
    },
  ],
  grammar: [
    {
      name: "Grammar (simulated)",
      display: "simulated-provider.x402.dev",
      real: false,
      ready: () => true,
      run: (task) => ({ text: SIM_RESULTS.grammar(task) }),
    },
  ],
  code: [
    {
      name: "Code (simulated)",
      display: "simulated-provider.x402.dev",
      real: false,
      ready: () => true,
      run: (task) => ({ text: SIM_RESULTS.code(task) }),
    },
  ],
  review: [
    {
      name: "Review (simulated)",
      display: "simulated-provider.x402.dev",
      real: false,
      ready: () => true,
      run: (task) => ({ text: SIM_RESULTS.review(task) }),
    },
  ],
};

// ── failover executor ────────────────────────────────────────────────────────

export async function fetchProvider(serviceId, task, logs, onResult) {
  const chain = CHAINS[serviceId];
  if (!chain) throw new Error(`No provider chain for ${serviceId}`);

  let failover = false;

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    const isPrimary = i === 0;

    if (!provider.ready()) {
      // Clean demo message — no raw "API key not configured" internals.
      logs.add(
        "API_REQUEST",
        "Primary unavailable → switching to backup provider",
        "warning",
        serviceId,
        250
      );
      onResult("failover");
      continue;
    }

    // DEMO_FAILOVER forces the primary real provider to fail once, so the
    // failover path is always demonstrated even with working API keys.
    if (isPrimary && provider.real && DEMO_FAILOVER) {
      logs.add(
        "FAILOVER_TRIGGERED",
        "Primary unavailable → switching to backup provider (forced demo failover)",
        "warning",
        serviceId,
        300
      );
      onResult("failover");
      failover = true;
      continue;
    }

    const t0 = Date.now();
    logs.add(
      "API_REQUEST",
      `GET ${provider.display} → requesting (${provider.name})`,
      isPrimary ? "info" : "running",
      serviceId,
      300
    );

    try {
      const out = await provider.run(task);
      const ms = Date.now() - t0;
      return {
        url: provider.display,
        provider: provider.name,
        ms,
        payload: typeof out === "string" ? out : out.text,
        backup: i > 0,
      };
    } catch (err) {
      logs.add(
        "FAILOVER_TRIGGERED",
        "Primary unavailable → switching to backup provider",
        "warning",
        serviceId,
        300
      );
      onResult("failover");
      failover = true;
    }
  }

  throw new Error(`All providers failed for ${serviceId}`);
}