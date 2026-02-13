import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { BlockchainClient } from "./blockchain.js";
import { MASP_PROTOCOL_VERSION, probeExternalEndpoint } from "./agent-engine.js";
import { PERSONALITIES, STRATEGIES } from "./personalities.js";
import { SimulationEngine } from "./simulation.js";
import { connectDB } from "./database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Connect to MongoDB
connectDB();

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    }
  })
);
app.use(express.json());

const blockchain = new BlockchainClient();
const simulation = new SimulationEngine(blockchain);

function badRequest(res, message) {
  return res.status(400).json({ success: false, error: message });
}

function normalizeName(value) {
  return (value || "").trim();
}

function defaultModelForProvider(provider) {
  const key = String(provider || "groq").toLowerCase();
  if (key === "openai") return "gpt-4o-mini";
  if (key === "openrouter") return "openai/gpt-4o-mini";
  return "llama-3.1-8b-instant";
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function ensureAutonomousSimulation() {
  if (!simulation.running) {
    simulation.start(8000);
  }
}

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    chainMode: blockchain.enabled ? "onchain" : "local-only",
    agents: simulation.agents.length,
    step: simulation.stepCount
  });
});

app.get("/api/personalities", (_, res) => {
  res.json({
    personalities: PERSONALITIES,
    strategies: STRATEGIES
  });
});

app.post("/api/agents/create", async (req, res) => {
  const name = normalizeName(req.body?.name);
  const personality = req.body?.personality || pickRandom(Object.keys(PERSONALITIES));
  const strategy = req.body?.strategy || pickRandom(Object.keys(STRATEGIES));
  const walletAddress = req.body?.wallet_address || undefined;

  if (!name) return badRequest(res, "name is required");
  if (!PERSONALITIES[personality]) return badRequest(res, "invalid personality");
  if (!STRATEGIES[strategy]) return badRequest(res, "invalid strategy");
  if (simulation.agents.find((a) => a.name === name)) return badRequest(res, "agent name already exists");

  try {
    const agent = simulation.createHostedAgent({ name, personality, strategy, walletAddress });
    const chain = await simulation.registerAgentOnchain(agent);
    ensureAutonomousSimulation();

    res.json({
      success: true,
      agent: {
        name: agent.name,
        type: agent.kind,
        wallet: agent.walletAddress,
        personality,
        strategy
      },
      chain
    });
  } catch (error) {
    return badRequest(res, error.message);
  }
});

app.post("/api/agents/create-external", async (req, res) => {
  const name = normalizeName(req.body?.name);
  const endpoint = (req.body?.agent_endpoint || "").trim();
  const apiKey = req.body?.api_key || null;
  const walletAddress = req.body?.wallet_address || undefined;
  const strictCompatibility = Boolean(req.body?.strict_compatibility);

  if (!name) return badRequest(res, "name is required");
  if (!endpoint) return badRequest(res, "agent_endpoint is required");
  if (!/^https?:\/\//i.test(endpoint)) return badRequest(res, "agent_endpoint must start with http:// or https://");
  if (simulation.agents.find((a) => a.name === name)) return badRequest(res, "agent name already exists");

  try {
    const probe = await probeExternalEndpoint(endpoint, apiKey);
    if (!probe.ok && strictCompatibility) {
      return badRequest(res, `external endpoint compatibility probe failed: ${probe.reason}`);
    }

    const agent = simulation.createExternalAgent({ name, endpoint, apiKey, walletAddress });
    const chain = await simulation.registerAgentOnchain(agent);
    ensureAutonomousSimulation();
    res.json({
      success: true,
      agent: {
        name: agent.name,
        type: agent.kind,
        wallet: agent.walletAddress,
        endpoint
      },
      chain,
      compatibility: {
        protocolVersion: MASP_PROTOCOL_VERSION,
        strict: strictCompatibility,
        probe
      }
    });
  } catch (error) {
    return badRequest(res, error.message);
  }
});

app.post("/api/agents/create-llm", async (req, res) => {
  const name = normalizeName(req.body?.name);
  const apiKey = (req.body?.api_key || "").trim();
  const provider = String(req.body?.provider || "groq").trim().toLowerCase();
  const model = (req.body?.model || "").trim() || defaultModelForProvider(provider);
  const baseUrl = (req.body?.base_url || "").trim();
  const walletAddress = req.body?.wallet_address || undefined;

  if (!name) return badRequest(res, "name is required");
  if (!apiKey) return badRequest(res, "api_key is required");
  if (!["groq", "openai", "openrouter", "custom"].includes(provider)) {
    return badRequest(res, "provider must be one of: groq, openai, openrouter, custom");
  }
  if (provider === "custom" && !/^https?:\/\//i.test(baseUrl)) {
    return badRequest(res, "base_url is required for custom provider and must start with http:// or https://");
  }
  if (simulation.agents.find((a) => a.name === name)) return badRequest(res, "agent name already exists");

  try {
    const agent = simulation.createLLMAgent({ name, apiKey, model, provider, baseUrl, walletAddress });
    const chain = await simulation.registerAgentOnchain(agent);
    ensureAutonomousSimulation();
    res.json({
      success: true,
      agent: {
        name: agent.name,
        type: agent.kind,
        wallet: agent.walletAddress,
        provider,
        model,
        base_url: baseUrl || undefined
      },
      chain
    });
  } catch (error) {
    return badRequest(res, error.message);
  }
});

app.post("/api/agents/probe-external", async (req, res) => {
  const endpoint = (req.body?.agent_endpoint || "").trim();
  const apiKey = req.body?.api_key || null;
  if (!endpoint) return badRequest(res, "agent_endpoint is required");
  if (!/^https?:\/\//i.test(endpoint)) return badRequest(res, "agent_endpoint must start with http:// or https://");

  const probe = await probeExternalEndpoint(endpoint, apiKey);
  res.json({
    success: probe.ok,
    protocolVersion: MASP_PROTOCOL_VERSION,
    probe
  });
});

app.get("/api/agents/list", (_, res) => {
  res.json({ agents: simulation.listAgents() });
});

app.get("/api/chain/proof", (req, res) => {
  const limit = Number(req.query?.limit || 50);
  res.json(simulation.chainProof(limit));
});

app.post("/api/agents/remove", (req, res) => {
  const name = normalizeName(req.body?.name);
  if (!name) return badRequest(res, "name is required");
  const removed = simulation.removeAgentByName(name);
  if (!removed) return badRequest(res, "agent not found");
  return res.json({ success: true, removed: name });
});

app.post("/api/simulation/start", (req, res) => {
  const intervalMs = Number(req.body?.interval_ms || 15000);
  simulation.start(intervalMs);
  res.json({ success: true, running: simulation.running, intervalMs });
});

app.post("/api/simulation/stop", (_, res) => {
  simulation.stop();
  res.json({ success: true, running: simulation.running });
});

app.post("/api/simulation/step", async (_, res) => {
  try {
    const result = await simulation.step();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get("/api/feed", (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
  const items = simulation.feed.slice(-limit).reverse().map(({ _viewedBy, ...rest }) => rest);
  res.json({ feed: items });
});

app.post("/api/feed/clear", (_, res) => {
  simulation.clearFeed();
  res.json({ success: true });
});

app.post("/api/feed/remove-fallbacks", (_, res) => {
  const removed = simulation.removeFallbackFeedEntries();
  res.json({ success: true, removed });
});

app.get("/api/leaderboard", (_, res) => {
  res.json({ leaderboard: simulation.leaderboard() });
});

app.get("/api/state", (_, res) => {
  res.json({
    running: simulation.running,
    step: simulation.stepCount,
    totalAccusations: simulation.totalAccusations,
    agents: simulation.listAgents()
  });
});

app.use("/", express.static(path.join(__dirname, "public")));

const port = Number(process.env.MASP_PORT || 8000);
app.listen(port, () => {
  console.log(`MASP server listening on http://localhost:${port}`);
  console.log(`Blockchain mode: ${blockchain.enabled ? "onchain" : "local-only"}`);
});
