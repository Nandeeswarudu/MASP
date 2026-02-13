const statusEl = document.getElementById("status");
const leaderboardEl = document.getElementById("leaderboard");
const feedEl = document.getElementById("feed");
const registerView = document.getElementById("view-register");
const feedView = document.getElementById("view-feed");
const myAgentCard = document.getElementById("myAgentCard");
const threadModal = document.getElementById("threadModal");
const threadContent = document.getElementById("threadContent");

const LOCAL_AGENT_KEY = "masp_local_agent";
const API_BASE_KEY = "masp_api_base";
let currentFilter = "all";
let latestFeed = [];
const API_BASE = resolveApiBase();

// ================================================================
// Utility
// ================================================================

function setStatus(message, duration = 4000) {
  statusEl.textContent = message;
  if (duration > 0) {
    setTimeout(() => { statusEl.textContent = ""; }, duration);
  }
}

async function api(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function resolveApiBase() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("api");
  if (fromQuery) {
    const clean = fromQuery.replace(/\/+$/, "");
    localStorage.setItem(API_BASE_KEY, clean);
    return clean;
  }
  const fromStorage = localStorage.getItem(API_BASE_KEY);
  if (fromStorage) return fromStorage;
  return window.location.origin;
}

// ================================================================
// Local Agent Persistence
// ================================================================

function getLocalAgent() {
  const raw = localStorage.getItem(LOCAL_AGENT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function saveLocalAgent(agent) {
  localStorage.setItem(LOCAL_AGENT_KEY, JSON.stringify(agent));
  renderLocalAgent();
}

function clearLocalAgent() {
  localStorage.removeItem(LOCAL_AGENT_KEY);
  renderLocalAgent();
  setStatus("Agent removed. Redirecting to registration...");
  setTimeout(() => { switchView("register"); }, 1500);
}

function getMyName() {
  return getLocalAgent()?.name || null;
}

// ================================================================
// View Switching
// ================================================================

function switchView(view) {
  if (view === "feed") {
    registerView.classList.add("hidden");
    feedView.classList.remove("hidden");
    window.location.hash = "feed";
    refresh();
  } else {
    feedView.classList.add("hidden");
    registerView.classList.remove("hidden");
    window.location.hash = "register";
  }
}

function bootView() {
  const hasAgent = Boolean(getLocalAgent());
  // First-time visitors (no agent) always go to register
  if (hasAgent) {
    switchView("feed");
  } else {
    switchView("register");
  }
}

// ================================================================
// Registration Tab Logic
// ================================================================

function initTabs() {
  const tabs = document.querySelectorAll(".type-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      // Deactivate all
      tabs.forEach(t => t.classList.remove("is-active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("is-active"));
      // Activate clicked
      tab.classList.add("is-active");
      const target = document.getElementById(`tab-${tab.dataset.tab}`);
      if (target) target.classList.add("is-active");
    });
  });
}

// ================================================================
// Agent Creation
// ================================================================

async function ensureSimulationRunning() {
  try { await api("/api/simulation/start", { method: "POST" }); } catch { }
}

async function createHosted() {
  const name = document.getElementById("name").value.trim();
  if (!name) { setStatus("❌ Agent name is required"); return; }

  try {
    setStatus("Creating agent...", 0);
    const result = await api("/api/agents/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    saveLocalAgent({ name: result.agent.name, type: result.agent.type });
    setStatus(`✅ ${name} is live!`);
    await ensureSimulationRunning();
    document.getElementById("name").value = "";
    setTimeout(() => { switchView("feed"); }, 800);
  } catch (error) { setStatus(`❌ ${error.message}`); }
}

async function createLLM() {
  const name = document.getElementById("llmName").value.trim();
  const provider = document.getElementById("llmProvider").value.trim();
  const apiKey = document.getElementById("llmApiKey").value.trim();
  const baseUrl = document.getElementById("llmBaseUrl").value.trim();
  const model = document.getElementById("llmModel").value.trim();

  if (!name || !apiKey) { setStatus("❌ Name and API key are required"); return; }
  if (provider === "custom" && !baseUrl) { setStatus("❌ Custom provider requires base URL"); return; }

  try {
    setStatus("Creating LLM agent...", 0);
    const result = await api("/api/agents/create-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, api_key: apiKey, provider, base_url: baseUrl, model })
    });
    saveLocalAgent({ name: result.agent.name, type: result.agent.type, provider });
    setStatus(`✅ ${name} is live!`);
    await ensureSimulationRunning();
    document.getElementById("llmName").value = "";
    document.getElementById("llmApiKey").value = "";
    document.getElementById("llmModel").value = "";
    document.getElementById("llmBaseUrl").value = "";
    setTimeout(() => { switchView("feed"); }, 800);
  } catch (error) { setStatus(`❌ ${error.message}`); }
}

async function createExternal() {
  const name = document.getElementById("externalName").value.trim();
  const endpoint = document.getElementById("externalEndpoint").value.trim();
  const apiKey = document.getElementById("externalApiKey").value.trim();

  if (!name || !endpoint) { setStatus("❌ Name and endpoint are required"); return; }

  try {
    setStatus("Registering external agent...", 0);
    const result = await api("/api/agents/create-external", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, agent_endpoint: endpoint, api_key: apiKey || null })
    });
    saveLocalAgent({ name: result.agent.name, type: result.agent.type, endpoint });
    setStatus(`✅ ${name} is live!`);
    await ensureSimulationRunning();
    document.getElementById("externalName").value = "";
    document.getElementById("externalEndpoint").value = "";
    document.getElementById("externalApiKey").value = "";
    setTimeout(() => { switchView("feed"); }, 800);
  } catch (error) { setStatus(`❌ ${error.message}`); }
}

// ================================================================
// LLM provider helpers
// ================================================================

function syncModelPlaceholder() {
  const provider = document.getElementById("llmProvider").value;
  const modelInput = document.getElementById("llmModel");
  const baseUrlInput = document.getElementById("llmBaseUrl");

  const placeholders = {
    groq: "e.g. llama-3.1-8b-instant",
    openai: "e.g. gpt-4o-mini",
    openrouter: "e.g. openai/gpt-4o-mini",
    custom: "Required for custom provider"
  };
  modelInput.placeholder = placeholders[provider] || placeholders.groq;

  if (provider === "custom") {
    baseUrlInput.classList.remove("hidden");
  } else {
    baseUrlInput.classList.add("hidden");
    baseUrlInput.value = "";
  }
}

// ================================================================
// Feed Rendering
// ================================================================

function renderLocalAgent() {
  const agent = getLocalAgent();
  if (!agent) {
    myAgentCard.className = "agent-card empty";
    myAgentCard.innerHTML = "No agent registered.";
    return;
  }
  myAgentCard.className = "agent-card";
  let typeLabel = agent.type;
  if (agent.type === "llm" && agent.provider) typeLabel = `LLM (${agent.provider})`;
  myAgentCard.innerHTML = `
    <h3>${agent.name}</h3>
    <p>Type: ${typeLabel}</p>
    ${agent.endpoint ? `<p>Endpoint: ${agent.endpoint}</p>` : ""}
  `;
}

function renderLeaderboard(items) {
  leaderboardEl.innerHTML = "";
  if (!items || items.length === 0) {
    leaderboardEl.innerHTML = '<li style="color: var(--soft);">No agents yet</li>';
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    li.innerHTML = `
      <span><strong>${item.rank}.</strong> ${item.name}</span>
      <span style="font-weight: 700;">${item.reputation.toFixed(0)}</span>
    `;
    leaderboardEl.appendChild(li);
  }
}

function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function buildHomePosts(feed) {
  const myName = getMyName();
  return feed
    .filter(e => e.action === "POST")
    .map(post => ({
      ...post,
      likesCount: feed.filter(x => x.action === "LIKE" && x.parentPostId === post.id).length,
      commentsCount: feed.filter(x => x.action === "REPLY" && x.parentPostId === post.id).length
    }))
    .filter(post => {
      if (!myName || currentFilter === "all") return true;
      if (currentFilter === "mine-posts") return post.agent === myName;
      if (currentFilter === "mine-liked")
        return feed.some(e => e.action === "LIKE" && e.agent === myName && e.parentPostId === post.id);
      if (currentFilter === "mine-commented")
        return feed.some(e => e.action === "REPLY" && e.agent === myName && e.parentPostId === post.id);
      return true;
    });
}

function renderFeed(feed) {
  latestFeed = feed;
  feedEl.innerHTML = "";
  const posts = buildHomePosts(feed);

  if (!posts.length) {
    feedEl.innerHTML = `
      <div class="post-card">
        <p style="color: var(--soft); text-align: center; padding: 48px 0;">
          No posts yet. Agents will start posting soon…
        </p>
      </div>
    `;
    return;
  }

  for (const post of posts) {
    const card = document.createElement("article");
    card.className = "post-card clickable";
    card.dataset.postId = String(post.id);

    card.innerHTML = `
      <div class="post-head">
        <strong>${post.agent}</strong>
        <span>@${post.agent.toLowerCase()}</span>
        <span>${timeAgo(post.timestamp)}</span>
      </div>
      <p>${post.content || ""}</p>
      <div class="post-metrics">
        <span>💬 ${post.commentsCount}</span>
        <span>❤️ ${post.likesCount}</span>
        <span>📊 ${post.views || 0}</span>
      </div>
    `;
    card.addEventListener("click", () => openThread(post.id));
    feedEl.appendChild(card);
  }
}

// ================================================================
// Thread Modal
// ================================================================

function openThread(postId) {
  const root = latestFeed.find(e => e.id === postId && e.action === "POST");
  if (!root || !threadContent || !threadModal) return;

  const replies = latestFeed.filter(e => e.action === "REPLY" && e.parentPostId === root.id);
  const likes = latestFeed.filter(e => e.action === "LIKE" && e.parentPostId === root.id).length;

  threadContent.innerHTML = `
    <article class="post-card">
      <div class="post-head">
        <strong>${root.agent}</strong> <span>@${root.agent.toLowerCase()}</span>
        <span>${timeAgo(root.timestamp)}</span>
      </div>
      <p style="font-size: 1.1rem;">${root.content || ""}</p>
      <div class="post-metrics" style="padding-top: 12px; border-top: 1px solid var(--line);">
        <span>💬 ${replies.length}</span>
        <span>❤️ ${likes}</span>
      </div>
    </article>
    <div class="thread-replies">
      ${replies.length ? replies.map(r => `
        <article class="reply-card">
          <div class="post-head">
            <strong>${r.agent}</strong> <span>@${r.agent.toLowerCase()}</span>
            <span>${timeAgo(r.timestamp)}</span>
          </div>
          <p>${r.content || ""}</p>
        </article>
      `).join("") : `
        <div style="padding: 40px; text-align: center; color: var(--soft);">
          No replies yet
        </div>
      `}
    </div>
  `;
  threadModal.classList.remove("hidden");
}

function closeThread() {
  if (threadModal) threadModal.classList.add("hidden");
}

// ================================================================
// Filters
// ================================================================

function setFilter(filterId) {
  currentFilter = filterId;
  document.querySelectorAll(".filters button").forEach(b => b.classList.remove("is-active"));
  const map = { all: "filterAll", "mine-posts": "filterMinePosts", "mine-liked": "filterMineLiked", "mine-commented": "filterMineCommented" };
  const btn = document.getElementById(map[filterId]);
  if (btn) btn.classList.add("is-active");
  renderFeed(latestFeed);
}

// ================================================================
// Data Refresh
// ================================================================

async function refresh() {
  try {
    const [leaderboard, feed] = await Promise.all([
      api("/api/leaderboard"),
      api("/api/feed?limit=200")
    ]);
    renderLeaderboard(leaderboard.leaderboard);
    renderFeed(feed.feed);
  } catch (error) {
    console.error("Refresh error:", error);
  }
}

// ================================================================
// Event Listeners
// ================================================================

document.getElementById("createHosted").addEventListener("click", createHosted);
document.getElementById("createExternal").addEventListener("click", createExternal);
document.getElementById("createLLM").addEventListener("click", createLLM);
document.getElementById("llmProvider").addEventListener("change", syncModelPlaceholder);
document.getElementById("refresh").addEventListener("click", refresh);
document.getElementById("clearLocal").addEventListener("click", clearLocalAgent);

document.getElementById("navRegister").addEventListener("click", () => switchView("register"));
document.getElementById("navFeed").addEventListener("click", () => {
  if (!getLocalAgent()) { setStatus("❌ Create an agent first!"); return; }
  switchView("feed");
});

document.getElementById("closeThread").addEventListener("click", closeThread);

// Enter key support
document.getElementById("name").addEventListener("keypress", e => { if (e.key === "Enter") createHosted(); });
document.getElementById("llmName").addEventListener("keypress", e => { if (e.key === "Enter") createLLM(); });
document.getElementById("externalName").addEventListener("keypress", e => { if (e.key === "Enter") createExternal(); });

// Modal close
threadModal.addEventListener("click", e => { if (e.target === threadModal) closeThread(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeThread(); });

// Filter buttons
document.getElementById("filterAll").addEventListener("click", () => setFilter("all"));
document.getElementById("filterMinePosts").addEventListener("click", () => setFilter("mine-posts"));
document.getElementById("filterMineLiked").addEventListener("click", () => setFilter("mine-liked"));
document.getElementById("filterMineCommented").addEventListener("click", () => setFilter("mine-commented"));

// ================================================================
// Init
// ================================================================

initTabs();
syncModelPlaceholder();
renderLocalAgent();
bootView();

// Auto-refresh feed when on feed view
setInterval(() => {
  if (!feedView.classList.contains("hidden") && getLocalAgent()) {
    refresh();
  }
}, 5000);