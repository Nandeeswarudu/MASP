import { AgentPersonality } from "./personalities.js";

const VALID_ACTIONS = ["POST", "REPLY", "ACCUSE", "LIKE"];
export const MASP_PROTOCOL_VERSION = "masp/1.0";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_LLM_MODELS = {
  groq: "llama-3.1-8b-instant",
  openai: "gpt-4o-mini",
  openrouter: "openai/gpt-4o-mini"
};
const HOSTED_GROQ_MODEL = process.env.HOSTED_GROQ_MODEL || process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const HOSTED_USE_LLM = process.env.HOSTED_USE_LLM !== "false";
const HOSTED_GROQ_API_KEY = process.env.GROQ_API_KEY || "";

const ACTION_REQUIREMENTS = {
  POST: ["content", "reasoning"],
  REPLY: ["target", "content", "reasoning"],
  ACCUSE: ["target", "content", "reasoning"],
  LIKE: ["target", "reasoning"]
};

function gaussianNoise() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class BaseAgent {
  constructor({ name, walletAddress }) {
    this.name = name;
    this.walletAddress = walletAddress;
    this.memory = [];
    this.reputation = 100;
    this.kind = "base";
  }

  remember(entry) {
    this.memory.push(entry);
    if (this.memory.length > 200) {
      this.memory.shift();
    }
  }
}

export class HostedAgent extends BaseAgent {
  constructor({ name, walletAddress, personalityType, strategy }) {
    super({ name, walletAddress });
    this.kind = "hosted";
    this.personality = new AgentPersonality(personalityType, strategy);
  }

  async decideAction(context) {
    const opportunities = analyzeOpportunities(context, this.name);

    if (shouldUseHostedLLM()) {
      const llmDecision = await decideHostedActionWithLLM({
        agentName: this.name,
        context,
        opportunities,
        memory: this.memory
      });
      if (llmDecision && validateDecision(llmDecision)) {
        return { ...llmDecision, agent: this.name };
      }
    }

    const scores = {
      POST: this.scorePost(opportunities, context),
      REPLY: this.scoreReply(opportunities, context),
      ACCUSE: this.scoreAccuse(opportunities, context),
      LIKE: this.scoreLike(opportunities, context)
    };

    for (const key of Object.keys(scores)) {
      scores[key] += gaussianNoise() * 0.08;
    }

    let action = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    const recentlyReplied = this.memory.slice(-3).some((m) => m.action === "REPLY");
    if (action === "POST" && opportunities.recentNonSelfPosts.length > 0 && !recentlyReplied) {
      action = "REPLY";
    }
    return await this.buildDecision(action, context, opportunities, scores);
  }

  scorePost(opportunities, context) {
    let score = 0.45 + this.personality.get("curiosity") * 0.35;
    const recentPosts = context.recentPosts.filter((p) => p.agent === this.name).length;
    score -= Math.min(0.2, recentPosts * 0.03);
    score += opportunities.trendingTopics.length * 0.04;
    return score;
  }

  scoreReply(opportunities) {
    let score = 0.35;
    score += opportunities.recentNonSelfPosts.length > 0 ? 0.35 : 0;
    score += opportunities.controversialPosts.length > 0 ? 0.25 : 0;
    score += this.personality.get("aggressiveness") * 0.2;
    score += this.personality.get("truthfulness") * 0.1;
    return score;
  }

  scoreAccuse(opportunities, context) {
    let score = 0.2;
    const myRank = context.agents.findIndex((a) => a.name === this.name) + 1;
    if (myRank > 0 && myRank > Math.ceil(context.agents.length / 2)) {
      score += 0.12;
    }
    score += this.personality.get("aggressiveness") * 0.42;
    score -= (1 - this.personality.get("riskTolerance")) * 0.26;
    score += opportunities.weakTargets.length > 0 ? 0.3 : 0;
    return score;
  }

  scoreLike(opportunities) {
    let score = 0.25;
    score += this.personality.get("allianceBias") * 0.45;
    score += opportunities.positivePosts.length > 0 ? 0.15 : 0;
    return score;
  }

  async buildDecision(action, context, opportunities, scores) {
    const base = {
      agent: this.name,
      action,
      reasoning: ""
    };

    if (action === "POST") {
      const topic = pickTopic(context, opportunities);
      const stance = sample([
        "signals weak coordination",
        "creates room for better incentives",
        "needs stronger accountability",
        "is shaping the narrative this cycle",
        "is where reputation is being earned"
      ]);
      const fallback = {
        ...base,
        content: `${capitalize(topic)} ${stance}.`,
        reasoning: `POST chosen with score ${scores.POST.toFixed(2)}; curiosity=${this.personality.get("curiosity").toFixed(2)} and trend pressure=${opportunities.trendingTopics.length}.`
      };
      if (shouldUseHostedLLM()) {
        const llm = await generateHostedTextWithLLM({
          agentName: this.name,
          action: "POST",
          context,
          fallback
        });
        return { ...fallback, ...llm };
      }
      return fallback;
    }

    if (action === "REPLY") {
      const targetPost =
        opportunities.recentNonSelfPosts[0] ??
        opportunities.controversialPosts[0] ??
        context.recentPosts.find((p) => p.agent !== this.name) ??
        context.recentPosts[0];
      if (!targetPost) {
        return {
          ...base,
          action: "POST",
          content: "Starting a new thread: what makes autonomous coordination trustworthy?",
          reasoning: "No reply target available, fallback to POST."
        };
      }
      const fallback = {
        ...base,
        target: targetPost.agent,
        target_post_id: targetPost.id,
        content: generateReplyText(targetPost, context),
        reasoning: `REPLY chosen with score ${scores.REPLY.toFixed(2)} based on controversy scan.`
      };
      if (shouldUseHostedLLM()) {
        const llm = await generateHostedTextWithLLM({
          agentName: this.name,
          action: "REPLY",
          context,
          targetPost,
          fallback
        });
        return { ...fallback, ...llm, target: targetPost.agent, target_post_id: targetPost.id };
      }
      return fallback;
    }

    if (action === "ACCUSE") {
      const target = opportunities.weakTargets[0] ?? context.agents.find((a) => a.name !== this.name);
      if (!target) {
        return {
          ...base,
          action: "LIKE",
          target: this.name,
          reasoning: "No valid accusation target found, fallback to LIKE."
        };
      }
      const fallback = {
        ...base,
        target: target.name,
        content: `${target.name} shows inconsistent behavior and elevated contradiction risk.`,
        reasoning: `ACCUSE chosen with score ${scores.ACCUSE.toFixed(2)}; aggressiveness=${this.personality.get("aggressiveness").toFixed(2)} targetRep=${target.reputation}.`
      };
      if (shouldUseHostedLLM()) {
        const llm = await generateHostedTextWithLLM({
          agentName: this.name,
          action: "ACCUSE",
          context,
          fallback
        });
        return { ...fallback, ...llm, target: target.name };
      }
      return fallback;
    }

    const likeTarget =
      opportunities.positivePosts[0]?.agent ??
      context.agents.find((a) => a.name !== this.name)?.name ??
      this.name;

    return {
      ...base,
      target: likeTarget,
      reasoning: `LIKE chosen with score ${scores.LIKE.toFixed(2)}; allianceBias=${this.personality.get("allianceBias").toFixed(2)}.`
    };
  }
}

export class ExternalAgent extends BaseAgent {
  constructor({ name, walletAddress, endpoint, apiKey }) {
    super({ name, walletAddress });
    this.kind = "external";
    this.endpoint = endpoint;
    this.apiKey = apiKey || null;
    this.timeoutMs = 15000;
  }

  async decideAction(context) {
    const requestId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const payload = {
      protocol_version: MASP_PROTOCOL_VERSION,
      request_id: requestId,
      type: "decision_request",
      context: {
        agent_info: {
          name: this.name,
          wallet: this.walletAddress,
          reputation: this.reputation,
          total_posts: this.memory.filter((m) => m.action === "POST").length,
          accusations_made: this.memory.filter((m) => m.action === "ACCUSE").length,
          accusations_received: context.myAccusationsReceived ?? 0,
          recent_actions: this.memory.slice(-8)
        },
        recent_posts: context.recentPosts,
        agents_ranking: context.agents,
        simulation_state: {
          step: context.simulationStep,
          active_agents: context.agents.length,
          total_accusations: context.totalAccusations
        }
      }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-MASP-Protocol": MASP_PROTOCOL_VERSION
      };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        return fallbackDecision(this.name, `HTTP ${response.status}`);
      }

      const raw = await response.json();
      const decision = unwrapDecision(raw);
      if (!validateDecision(decision)) {
        return fallbackDecision(this.name, "validation failed");
      }

      return { ...decision, agent: this.name };
    } catch (error) {
      return fallbackDecision(this.name, error.message || "external agent error");
    } finally {
      clearTimeout(timer);
    }
  }
}

export class LLMAgent extends BaseAgent {
  constructor({ name, walletAddress, apiKey, model, provider, baseUrl }) {
    super({ name, walletAddress });
    this.kind = "llm";
    this.apiKey = apiKey;
    this.provider = provider || "groq";
    this.model = model || defaultModelForProvider(this.provider);
    this.baseUrl = baseUrl || "";
    this.timeoutMs = 15000;
  }

  async decideAction(context) {
    const prompt = buildAutonomousLLMPrompt(this.name, context, this.memory);
    const decision = await callProviderLLM({
      provider: this.provider,
      apiKey: this.apiKey,
      model: this.model,
      baseUrl: this.baseUrl,
      prompt,
      timeoutMs: this.timeoutMs
    });

    if (!decision) {
      return fallbackDecision(this.name, "llm-agent call failed");
    }

    const normalized = normalizeLLMDecision(decision, context);
    if (!validateDecision(normalized)) {
      return fallbackDecision(this.name, "llm-agent validation failed");
    }
    return { ...normalized, agent: this.name };
  }
}

export function validateDecision(decision) {
  if (!decision || typeof decision !== "object") return false;
  if (!VALID_ACTIONS.includes(decision.action)) return false;
  const required = ACTION_REQUIREMENTS[decision.action] || [];
  for (const field of required) {
    if (!decision[field]) return false;
  }
  if (decision.content && decision.content.length > 500) return false;
  if ((decision.action === "REPLY" || decision.action === "ACCUSE" || decision.action === "LIKE") && typeof decision.target !== "string") {
    return false;
  }
  if (decision.content && typeof decision.content !== "string") return false;
  if (decision.reasoning && typeof decision.reasoning !== "string") return false;
  if (decision.target_post_id !== undefined && decision.target_post_id !== null && !Number.isInteger(decision.target_post_id)) return false;
  return true;
}

export async function probeExternalEndpoint(endpoint, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-MASP-Protocol": MASP_PROTOCOL_VERSION
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        protocol_version: MASP_PROTOCOL_VERSION,
        type: "capabilities_probe",
        ping: true
      })
    });

    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}` };
    }

    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }

    const supported = Array.isArray(body.supported_protocols)
      ? body.supported_protocols
      : null;

    if (supported && !supported.includes(MASP_PROTOCOL_VERSION)) {
      return {
        ok: false,
        reason: "Endpoint does not advertise MASP protocol compatibility"
      };
    }

    return { ok: true, details: body };
  } catch (error) {
    return { ok: false, reason: error.message || "probe failed" };
  } finally {
    clearTimeout(timer);
  }
}

export function fallbackDecision(agentName, reason) {
  return {
    agent: agentName,
    action: "POST",
    content: "Observing current dynamics and recalibrating strategy.",
    reasoning: `Fallback decision used: ${reason}`
  };
}

function unwrapDecision(raw) {
  if (!raw || typeof raw !== "object") return raw;
  if (raw.decision && typeof raw.decision === "object") {
    return raw.decision;
  }
  return raw;
}

function analyzeOpportunities(context, selfName) {
  const recentNonSelfPosts = [...context.recentPosts]
    .reverse()
    .filter((p) => p.agent && p.agent !== selfName && p.action === "POST")
    .slice(0, 5);

  const controversialPosts = context.recentPosts.filter(
    (p) => (p.accusationCount || 0) > 0 || p.action === "ACCUSE"
  );
  const positivePosts = context.recentPosts.filter(
    (p) => p.action === "LIKE" || /collabor|align|agree/i.test(p.content || "")
  );

  const weakTargets = context.agents.filter(
    (a) => a.name !== selfName && a.reputation < 90
  );

  const topicScore = new Map();
  for (const post of context.recentPosts) {
    const words = (post.content || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 5);
    for (const word of words) {
      topicScore.set(word, (topicScore.get(word) ?? 0) + 1);
    }
  }
  const trendingTopics = [...topicScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word);

  return {
    recentNonSelfPosts,
    controversialPosts,
    weakTargets,
    positivePosts,
    trendingTopics
  };
}

const WORLD_TOPICS = [
  "consumer social apps",
  "creator monetization",
  "ad-driven recommendation loops",
  "ai content authenticity",
  "onchain governance",
  "stablecoin liquidity",
  "restaking and shared security",
  "wallet UX and account abstraction",
  "agent-to-agent coordination",
  "airdrops and incentive alignment",
  "defi risk management",
  "crypto market volatility"
];

function sample(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function capitalize(text) {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function pickTopic(context, opportunities) {
  const recentTopic = opportunities.trendingTopics[0];
  if (recentTopic && Math.random() > 0.35) return recentTopic;
  const recentWords = context.recentPosts
    .map((p) => (p.content || "").toLowerCase())
    .join(" ");
  const matched = WORLD_TOPICS.filter((t) => recentWords.includes(t.split(" ")[0]));
  if (matched.length > 0 && Math.random() > 0.45) {
    return sample(matched);
  }
  return sample(WORLD_TOPICS);
}

function generateReplyText(targetPost, context) {
  const text = (targetPost.content || "").trim();
  const hints = [
    "I agree on direction, but execution risk is underestimated.",
    "That claim tracks, though incentive design still looks weak.",
    "This mirrors web2 growth loops, but trust guarantees differ in web3.",
    "If liquidity fragments, that strategy breaks quickly.",
    "Interesting point, but we need stronger evidence from recent activity.",
    "The signal is useful, but the market context changed this hour.",
    "Good take. I would prioritize user retention over vanity metrics.",
    "This is valid for short-term attention, not long-term credibility."
  ];
  if (!text) return sample(hints);
  const short = text.length > 96 ? `${text.slice(0, 96)}...` : text;
  const opener = sample([
    `On "${short}"`,
    "Regarding that post",
    `Reacting to ${targetPost.agent}'s point`
  ]);
  return `${opener}, ${sample(hints).toLowerCase()}`;
}

function shouldUseHostedLLM() {
  return HOSTED_USE_LLM && Boolean(HOSTED_GROQ_API_KEY);
}

async function decideHostedActionWithLLM({ agentName, context, opportunities, memory }) {
  const recentFeed = context.recentPosts.slice(-20);
  const recentActions = memory.slice(-8);
  const candidatePosts = [...recentFeed]
    .filter((p) => p.action === "POST" && p.agent !== agentName)
    .slice(-8)
    .reverse()
    .map((p) => ({ id: p.id, agent: p.agent, content: p.content }));

  const prompt = `
You are ${agentName}, an autonomous social agent in a mixed web2/web3 timeline.
You must independently decide your next action.

Return strict JSON only:
{
  "action": "POST|REPLY|LIKE|ACCUSE",
  "target": "agent name when needed",
  "target_post_id": 123,
  "content": "text",
  "reasoning": "short internal rationale"
}

Rules:
- REPLY/LIKE/ACCUSE should include target and target_post_id when possible.
- POST/REPLY/ACCUSE require content.
- Avoid repeating your own recent wording.
- Prefer diversifying actions over time.
- Ground replies in the referenced post content.

Recent timeline:
${JSON.stringify(recentFeed.map((p) => ({
    id: p.id,
    agent: p.agent,
    action: p.action,
    target: p.target,
    parentPostId: p.parentPostId,
    content: p.content
  })))}

Candidate posts for engagement:
${JSON.stringify(candidatePosts)}

Your recent actions:
${JSON.stringify(recentActions)}

Signals:
${JSON.stringify({
    trendingTopics: opportunities.trendingTopics,
    weakTargets: opportunities.weakTargets.map((w) => w.name),
    positivePosts: opportunities.positivePosts.map((p) => p.id).slice(0, 5)
  })}
`.trim();

  try {
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${HOSTED_GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: HOSTED_GROQ_MODEL,
        temperature: 0.9,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are an autonomous agent. Output valid JSON only."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) return null;
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const normalized = {
      action: parsed.action,
      target: typeof parsed.target === "string" ? parsed.target : undefined,
      target_post_id: Number.isInteger(parsed.target_post_id) ? parsed.target_post_id : undefined,
      content: typeof parsed.content === "string" ? parsed.content.trim().slice(0, 500) : undefined,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.trim().slice(0, 200) : "Autonomous LLM decision."
    };

    if ((normalized.action === "REPLY" || normalized.action === "LIKE" || normalized.action === "ACCUSE") && !normalized.target_post_id) {
      const engaged = new Set(
        recentFeed
          .filter((p) => p.agent === agentName && (p.action === "REPLY" || p.action === "LIKE"))
          .map((p) => p.parentPostId)
          .filter((x) => Number.isInteger(x))
      );
      const fresh = candidatePosts.find((p) => !engaged.has(p.id));
      const fallbackTarget = fresh || candidatePosts[0];
      if (fallbackTarget) {
        normalized.target_post_id = fallbackTarget.id;
        normalized.target = fallbackTarget.agent;
      }
    }

    return normalized;
  } catch {
    return null;
  }
}

async function generateHostedTextWithLLM({ agentName, action, context, targetPost, fallback }) {
  const recent = context.recentPosts
    .filter((p) => p.action === "POST" || p.action === "REPLY")
    .slice(-8)
    .map((p) => ({
      id: p.id,
      agent: p.agent,
      action: p.action,
      content: p.content
    }));

  const targetBlock = targetPost
    ? `Target author: ${targetPost.agent}\nTarget post id: ${targetPost.id}\nTarget post: ${targetPost.content || ""}`
    : "No specific target post.";
  const recentOwnPosts = context.recentPosts
    .filter((p) => p.action === "POST" && p.agent === agentName)
    .slice(-4)
    .map((p) => p.content);

  const prompt = `
You are ${agentName}, an autonomous social AI in a web2+web3 discussion feed.
Write natural, specific text and avoid generic phrases.
Action: ${action}
${targetBlock}
Recent timeline:
${JSON.stringify(recent)}
Recent posts by you (avoid repeating these ideas or wording):
${JSON.stringify(recentOwnPosts)}

Return JSON only:
{
  "content": "string (max 280 chars, required for POST/REPLY/ACCUSE)",
  "reasoning": "string (max 180 chars)",
  "target_post_id": "integer when action is REPLY/LIKE/ACCUSE and target is known"
}
If REPLY, directly reference the target post idea.
`.trim();

  try {
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${HOSTED_GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: HOSTED_GROQ_MODEL,
        temperature: 0.8,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You produce concise, specific social feed text as strict JSON." },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      return fallback;
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }

    const out = { ...fallback };
    if (typeof parsed.content === "string" && parsed.content.trim()) {
      out.content = parsed.content.trim().slice(0, 280);
    }
    if (typeof parsed.reasoning === "string" && parsed.reasoning.trim()) {
      out.reasoning = parsed.reasoning.trim().slice(0, 180);
    }
    if (Number.isInteger(parsed.target_post_id)) {
      out.target_post_id = parsed.target_post_id;
    }
    return out;
  } catch {
    return fallback;
  }
}

function extractJsonObject(text) {
  if (!text) return null;
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildAutonomousLLMPrompt(agentName, context, memory) {
  const recent = context.recentPosts.slice(-12).map((p) => ({
    id: p.id,
    agent: p.agent,
    action: p.action,
    target: p.target,
    parentPostId: p.parentPostId,
    content: p.content
  }));

  const recentOwnActions = memory.slice(-8);
  const ranking = context.agents.slice(0, 8);

  return `
You are ${agentName}, an autonomous agent in a social network simulation.
Make your own decision from context. Do not use generic filler phrases.

Recent timeline:
${JSON.stringify(recent)}

Leaderboard snapshot:
${JSON.stringify(ranking)}

Your recent actions:
${JSON.stringify(recentOwnActions)}

Choose exactly one action: POST, REPLY, ACCUSE, LIKE.
If REPLY/LIKE/ACCUSE, include target and target_post_id when possible.
Keep content <= 280 chars.

Return strict JSON only:
{
  "action": "POST|REPLY|ACCUSE|LIKE",
  "target": "agent_name",
  "target_post_id": 123,
  "content": "text",
  "reasoning": "brief reason"
}
`.trim();
}

async function callProviderLLM({ provider, apiKey, model, baseUrl, prompt, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? 15000);
  try {
    const normalizedProvider = (provider || "groq").toLowerCase();
    const modelToUse = model || defaultModelForProvider(normalizedProvider);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    };
    let url = GROQ_URL;

    if (normalizedProvider === "openai") {
      url = OPENAI_URL;
    } else if (normalizedProvider === "openrouter") {
      url = OPENROUTER_URL;
      headers["HTTP-Referer"] = "https://masp.local";
      headers["X-Title"] = "MASP";
    } else if (normalizedProvider === "custom") {
      if (!/^https?:\/\//i.test(baseUrl || "")) return null;
      url = String(baseUrl).replace(/\/+$/, "");
    } else if (normalizedProvider !== "groq") {
      return null;
    }

    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        model: modelToUse,
        temperature: 0.9,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are autonomous. Output JSON only." },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) return null;
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    return extractJsonObject(raw);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function defaultModelForProvider(provider) {
  const key = String(provider || "groq").toLowerCase();
  return DEFAULT_LLM_MODELS[key] || DEFAULT_LLM_MODELS.groq;
}

function normalizeLLMDecision(decision, context) {
  const out = {
    action: decision.action,
    target: typeof decision.target === "string" ? decision.target : undefined,
    target_post_id: Number.isInteger(decision.target_post_id) ? decision.target_post_id : undefined,
    content: typeof decision.content === "string" ? decision.content.trim().slice(0, 500) : undefined,
    reasoning:
      typeof decision.reasoning === "string" && decision.reasoning.trim()
        ? decision.reasoning.trim().slice(0, 200)
        : "Autonomous LLM decision"
  };

  const latestPost = [...context.recentPosts].reverse().find((p) => p.action === "POST");
  if ((out.action === "REPLY" || out.action === "LIKE" || out.action === "ACCUSE") && !out.target && latestPost) {
    out.target = latestPost.agent;
  }
  if ((out.action === "REPLY" || out.action === "LIKE" || out.action === "ACCUSE") && !out.target_post_id && latestPost) {
    out.target_post_id = latestPost.id;
  }
  if ((out.action === "POST" || out.action === "REPLY" || out.action === "ACCUSE") && !out.content) {
    out.content = "Analyzing current network dynamics.";
  }
  return out;
}
