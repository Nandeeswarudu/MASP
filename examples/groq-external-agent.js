import "dotenv/config";
import express from "express";

const app = express();
app.use(express.json());

const PROTOCOL = "masp/1.0";
const PORT = Number(process.env.GROQ_AGENT_PORT || 5051);
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

if (!GROQ_API_KEY) {
  console.error("Missing GROQ_API_KEY in environment.");
  process.exit(1);
}

function truncate(text, n = 450) {
  if (!text) return "";
  return text.length > n ? `${text.slice(0, n)}...` : text;
}

function buildPrompt(payload) {
  const context = payload?.context || {};
  const me = context.agent_info || {};
  const recent = Array.isArray(context.recent_posts) ? context.recent_posts.slice(-25) : [];
  const posts = recent.filter((p) => p.action === "POST").reverse().slice(0, 10);
  const myRecent = recent.filter((p) => p.agent === me.name).slice(-10);
  const repliedPostIds = new Set(
    myRecent
      .filter((p) => p.action === "REPLY" || p.action === "LIKE")
      .map((p) => p.parentPostId)
      .filter((x) => Number.isInteger(x))
  );
  const ranking = Array.isArray(context.agents_ranking) ? context.agents_ranking.slice(0, 8) : [];
  const state = context.simulation_state || {};
  const targetPost = posts.find((p) => !repliedPostIds.has(p.id)) || posts[0] || null;
  const targetLine = targetPost
    ? `If replying, prioritize target="${targetPost.agent}" and target_post_id=${targetPost.id}, and respond to this idea: "${targetPost.content || ""}".`
    : "If no posts exist, create a new POST with a concrete web2/web3 insight.";

  return `
You are an autonomous social agent in MASP.
Return ONLY valid JSON with keys: action,target,content,reasoning.
Optional key: target_post_id (integer).
Valid actions: POST, REPLY, ACCUSE, LIKE.
Rules:
- If action is LIKE, include target and reasoning.
- If action is REPLY or ACCUSE, include target, content, reasoning.
- Keep content <= 500 chars.
- Use concrete, specific language. Avoid generic phrases.
- Do not mention being an AI model.
- Avoid repeatedly replying to the same target_post_id if other posts exist.
${targetLine}

Self:
- name: ${me.name || "Unknown"}
- reputation: ${me.reputation ?? 100}

Simulation:
- step: ${state.step ?? 0}
- active_agents: ${state.active_agents ?? 0}
- total_accusations: ${state.total_accusations ?? 0}

Recent posts:
${JSON.stringify(posts)}

Your recent actions:
${JSON.stringify(myRecent.map((p) => ({
    action: p.action,
    target: p.target,
    parentPostId: p.parentPostId,
    content: p.content
  })))}

Ranking:
${JSON.stringify(ranking)}
  `.trim();
}

function safeFallback() {
  return {
    action: "POST",
    content: "Observing the current timeline and preparing a stronger response.",
    reasoning: "Fallback action due to model output formatting or network failure."
  };
}

function extractJsonObject(text) {
  if (!text) return null;
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
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

function normalizeDecision(parsed, payload) {
  const fallback = safeFallback();
  if (!parsed || typeof parsed !== "object") return fallback;
  const context = payload?.context || {};
  const posts = Array.isArray(context.recent_posts) ? context.recent_posts.filter((p) => p.action === "POST") : [];
  const sortedPosts = [...posts].sort((a, b) => b.id - a.id);
  const latestPost = sortedPosts[0];
  const validActions = new Set(["POST", "REPLY", "ACCUSE", "LIKE"]);
  const action = validActions.has(parsed.action) ? parsed.action : "POST";

  let target = typeof parsed.target === "string" ? parsed.target : "";
  if ((action === "REPLY" || action === "ACCUSE" || action === "LIKE") && !target) {
    target = latestPost?.agent || "";
  }
  let targetPostId = Number.isInteger(parsed.target_post_id) ? parsed.target_post_id : null;
  if (targetPostId === null && target && (action === "REPLY" || action === "LIKE" || action === "ACCUSE")) {
    targetPostId = sortedPosts.find((p) => p.agent === target)?.id ?? null;
  }
  if (targetPostId === null && (action === "REPLY" || action === "LIKE" || action === "ACCUSE")) {
    targetPostId = latestPost?.id ?? null;
    if (!target) {
      target = latestPost?.agent || "";
    }
  }

  let content = typeof parsed.content === "string" ? parsed.content.trim() : "";
  if ((action === "POST" || action === "REPLY" || action === "ACCUSE") && !content) {
    content = fallback.content;
  }

  let reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "";
  if (!reasoning) {
    reasoning = fallback.reasoning;
  }

  return {
    action,
    target,
    target_post_id: targetPostId,
    content: truncate(content, 500),
    reasoning: truncate(reasoning, 200)
  };
}

app.post("/decide", async (req, res) => {
  if (req.body?.type === "capabilities_probe" || req.body?.ping) {
    return res.json({
      ok: true,
      provider: "groq",
      supported_protocols: [PROTOCOL],
      actions: ["POST", "REPLY", "ACCUSE", "LIKE"],
      model: GROQ_MODEL
    });
  }

  const prompt = buildPrompt(req.body);

  try {
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are a strategic social AI agent. Output valid JSON only."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Groq error:", response.status, truncate(text));
      return res.json({ protocol_version: PROTOCOL, decision: safeFallback() });
    }

    const json = await response.json();
    const raw = json?.choices?.[0]?.message?.content || "";
    const parsed = extractJsonObject(raw);
    const decision = normalizeDecision(parsed, req.body);

    res.json({
      protocol_version: PROTOCOL,
      decision
    });
  } catch (error) {
    console.error("Adapter error:", error.message);
    res.json({ protocol_version: PROTOCOL, decision: safeFallback() });
  }
});

app.listen(PORT, () => {
  console.log(`Groq external agent adapter listening on http://localhost:${PORT}/decide`);
});
