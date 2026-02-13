import { ethers } from "ethers";
import { ExternalAgent, HostedAgent, LLMAgent } from "./agent-engine.js";
import { Agent, FeedItem, SimulationState } from "./database.js";

function nowIso() {
  return new Date().toISOString();
}

function sample(arr) {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export class SimulationEngine {
  constructor(blockchain) {
    this.blockchain = blockchain;
    this.agents = [];
    this.feed = [];
    this.chainEvents = [];
    this.stepCount = 0;
    this.totalAccusations = 0;
    this.running = false;
    this.interval = null;
    this.vouches = new Map();

    // Load state from DB immediately (async)
    console.log("SimulationEngine: Initializing...");
    this.loadState().then(() => {
      console.log("SimulationEngine: Initial load complete.");
    }).catch(err => {
      console.error("SimulationEngine: Error in initial load:", err);
    });
  }

  async loadState() {
    try {
      if (!process.env.MONGODB_URI) {
        console.warn("SimulationEngine: No MONGODB_URI, skipping DB load.");
        return;
      }

      console.log("SimulationEngine: Fetching state from MongoDB...");

      // 1. Load Global State
      const state = await SimulationState.findOne({ key: "global" });
      if (state) {
        this.stepCount = state.stepCount;
        this.totalAccusations = state.totalAccusations;
        if (state.vouches) {
          this.vouches = state.vouches;
        }
      }

      // 2. Load Agents
      const agentDocs = await Agent.find({});
      this.agents = agentDocs.map(doc => {
        let agent;
        if (doc.kind === "hosted") {
          agent = new HostedAgent({
            name: doc.name,
            walletAddress: doc.walletAddress,
            personalityType: doc.personalityType,
            strategy: doc.strategy
          });
        } else if (doc.kind === "external") {
          agent = new ExternalAgent({
            name: doc.name,
            walletAddress: doc.walletAddress,
            endpoint: doc.endpoint,
            apiKey: doc.apiKey
          });
        } else if (doc.kind === "llm") {
          agent = new LLMAgent({
            name: doc.name,
            walletAddress: doc.walletAddress,
            apiKey: doc.apiKey,
            model: doc.model,
            provider: doc.provider,
            baseUrl: doc.baseUrl
          });
        }
        if (agent) {
          agent.reputation = doc.reputation;
        }
        return agent;
      }).filter(Boolean);

      // 3. Load Feed (Last 100 items for context)
      const feedDocs = await FeedItem.find({}).sort({ id: 1 }).limit(500);
      this.feed = feedDocs.map(doc => ({
        id: doc.id,
        timestamp: doc.timestamp.toISOString(),
        step: doc.step,
        agent: doc.agent,
        wallet: doc.wallet,
        action: doc.action,
        target: doc.target,
        targetPostId: doc.targetPostId,
        parentPostId: doc.parentPostId,
        content: doc.content,
        reasoning: doc.reasoning,
        likes: doc.likes,
        comments: doc.comments,
        views: doc.views,
        accusationCount: doc.accusationCount,
        chainTxHash: doc.chainTxHash,
        chainContentHash: doc.chainContentHash,
        _viewedBy: new Set(doc._viewedBy || [])
      }));

      console.log(`SimulationEngine: Loaded ${this.agents.length} agents and ${this.feed.length} posts from MongoDB.`);
    } catch (err) {
      console.error("SimulationEngine: Failed to load simulation state from DB:", err);
    }
  }

  async saveGlobalState() {
    if (!process.env.MONGODB_URI) return;
    try {
      await SimulationState.updateOne(
        { key: "global" },
        {
          stepCount: this.stepCount,
          totalAccusations: this.totalAccusations,
          vouches: this.vouches
        },
        { upsert: true }
      );
    } catch (err) {
      console.error("SimulationEngine: Failed to save global state:", err);
    }
  }

  async saveAgent(agent) {
    if (!process.env.MONGODB_URI) return;
    try {
      await Agent.updateOne(
        { name: agent.name },
        {
          reputation: agent.reputation,
        }
      );
    } catch (err) {
      console.error(`SimulationEngine: Failed to save agent ${agent.name}:`, err);
    }
  }

  async createAgentInDB(agent, extraData = {}) {
    if (!process.env.MONGODB_URI) return;
    try {
      await Agent.create({
        name: agent.name,
        walletAddress: agent.walletAddress,
        kind: agent.kind,
        reputation: agent.reputation,
        ...extraData
      });
    } catch (err) {
      console.error(`SimulationEngine: Failed to create agent ${agent.name} in DB:`, err);
    }
  }

  async saveFeedItem(item) {
    if (!process.env.MONGODB_URI) return;
    try {
      await FeedItem.create({
        ...item,
        timestamp: new Date(item.timestamp),
        _viewedBy: Array.from(item._viewedBy || [])
      });
    } catch (err) {
      console.error("SimulationEngine: Failed to save feed item:", err);
    }
  }

  async updateFeedItemStats(item) {
    if (!process.env.MONGODB_URI) return;
    try {
      await FeedItem.updateOne(
        { id: item.id },
        {
          likes: item.likes,
          comments: item.comments,
          views: item.views,
          _viewedBy: Array.from(item._viewedBy || [])
        }
      );
    } catch (err) {
      console.error("SimulationEngine: Failed to update feed item stats:", err);
    }
  }

  listAgents() {
    return this.agents.map((a) => ({
      name: a.name,
      wallet: a.walletAddress,
      type: a.kind,
      reputation: a.reputation
    }));
  }

  async removeAgentByName(name) {
    const before = this.agents.length;
    this.agents = this.agents.filter((a) => a.name !== name);
    const changed = before !== this.agents.length;
    if (changed && process.env.MONGODB_URI) {
      await Agent.deleteOne({ name });
    }
    return changed;
  }

  async clearFeed() {
    this.feed = [];
    this.chainEvents = [];
    this.stepCount = 0;
    this.totalAccusations = 0;
    if (process.env.MONGODB_URI) {
      await FeedItem.deleteMany({});
      await this.saveGlobalState();
    }
  }

  removeFallbackFeedEntries() {
    const before = this.feed.length;
    const toRemove = this.feed.filter((p) => (p.reasoning || "").toLowerCase().includes("fallback decision used"));
    this.feed = this.feed.filter((p) => !(p.reasoning || "").toLowerCase().includes("fallback decision used"));

    if (toRemove.length > 0 && process.env.MONGODB_URI) {
      const ids = toRemove.map(i => i.id);
      FeedItem.deleteMany({ id: { $in: ids } }).catch(err => {
        console.error("SimulationEngine: Failed to remove fallback entries from DB:", err);
      });
    }
    return before - this.feed.length;
  }

  leaderboard() {
    return [...this.agents]
      .sort((a, b) => b.reputation - a.reputation)
      .map((a, i) => ({
        rank: i + 1,
        name: a.name,
        reputation: a.reputation,
        wallet: a.walletAddress,
        type: a.kind
      }));
  }

  createHostedAgent({ name, personality, strategy, walletAddress }) {
    const wallet = walletAddress || ethers.Wallet.createRandom().address;
    const agent = new HostedAgent({
      name,
      walletAddress: wallet,
      personalityType: personality,
      strategy
    });
    this.agents.push(agent);
    this.createAgentInDB(agent, { personalityType: personality, strategy });
    return agent;
  }

  createExternalAgent({ name, endpoint, apiKey, walletAddress }) {
    const wallet = walletAddress || ethers.Wallet.createRandom().address;
    const agent = new ExternalAgent({
      name,
      walletAddress: wallet,
      endpoint,
      apiKey
    });
    this.agents.push(agent);
    this.createAgentInDB(agent, { endpoint, apiKey });
    return agent;
  }

  createLLMAgent({ name, apiKey, model, provider, baseUrl, walletAddress }) {
    const wallet = walletAddress || ethers.Wallet.createRandom().address;
    const agent = new LLMAgent({
      name,
      walletAddress: wallet,
      apiKey,
      model,
      provider,
      baseUrl
    });
    this.agents.push(agent);
    this.createAgentInDB(agent, { apiKey, model, provider, baseUrl });
    return agent;
  }

  async registerAgentOnchain(agent) {
    try {
      const result = await this.blockchain.registerAgent(agent.walletAddress, agent.name);
      if (result?.txHash) {
        this.chainEvents.push({
          type: "REGISTER_AGENT",
          agent: agent.name,
          wallet: agent.walletAddress,
          txHash: result.txHash,
          timestamp: nowIso()
        });
      }
      return result;
    } catch (error) {
      return { error: error.message };
    }
  }

  chainProof(limit = 50) {
    const max = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;
    return {
      chainMode: this.blockchain.enabled ? "onchain" : "local-only",
      rpcConfigured: Boolean(this.blockchain.rpcUrl),
      contractAddress: this.blockchain.reputationAddress || null,
      recentTransactions: [...this.chainEvents].slice(-max).reverse()
    };
  }

  buildContextFor(agent) {
    const recentPosts = this.feed.slice(-20);
    for (const post of recentPosts) {
      if (post.action === "POST" && post.agent !== agent.name) {
        if (!post._viewedBy) post._viewedBy = new Set();
        if (!post._viewedBy.has(agent.name)) {
          post._viewedBy.add(agent.name);
          post.views = (post.views || 0) + 1;
          this.updateFeedItemStats(post);
        }
      }
    }
    return {
      recentPosts: recentPosts.map(p => ({
        ...p,
        _viewedBy: p._viewedBy ? Array.from(p._viewedBy) : []
      })),
      agents: this.leaderboard().map(({ name, reputation }) => ({ name, reputation })),
      myReputation: agent.reputation,
      myAccusationsReceived: this.feed.filter(
        (p) => p.action === "ACCUSE" && p.target === agent.name
      ).length,
      simulationStep: this.stepCount,
      totalAccusations: this.totalAccusations
    };
  }

  async step() {
    if (this.agents.length < 1) {
      throw new Error("At least 1 agent is required.");
    }

    this.stepCount += 1;
    await this.saveGlobalState();

    const ordered = [...this.agents].sort(() => Math.random() - 0.5);
    const emitted = [];

    for (const agent of ordered) {
      if (!this.shouldAgentAct(agent)) {
        continue;
      }
      const context = this.buildContextFor(agent);
      const decision = await agent.decideAction(context);
      const event = await this.executeDecision(agent, decision);
      if (event) {
        emitted.push(event);
        this.scheduleNextAction(agent);
      }
    }

    return {
      step: this.stepCount,
      actions: emitted,
      leaderboard: this.leaderboard()
    };
  }

  async executeDecision(agent, decision) {
    if (!decision) return null;

    const entry = {
      id: this.feed.length + 1,
      timestamp: nowIso(),
      step: this.stepCount,
      agent: agent.name,
      wallet: agent.walletAddress,
      action: decision.action,
      target: decision.target ?? null,
      targetPostId: Number.isInteger(decision.target_post_id) ? decision.target_post_id : null,
      parentPostId: null,
      content: decision.content ?? "",
      reasoning: decision.reasoning ?? "No reasoning provided",
      likes: 0,
      comments: 0,
      views: 0,
      accusationCount: 0,
      _viewedBy: new Set()
    };

    if (decision.action === "LIKE") {
      const targetPost = this.findTargetPost(decision);
      if (targetPost) {
        if (targetPost.agent === agent.name) return null;
        const alreadyLiked = this.feed.some(
          (e) => e.action === "LIKE" && e.agent === agent.name && e.parentPostId === targetPost.id
        );
        if (alreadyLiked) return null;

        targetPost.likes += 1;
        this.updateFeedItemStats(targetPost);

        entry.parentPostId = targetPost.id;
        entry.content = `Liked ${targetPost.agent}'s contribution.`;
        const vouchKey = `${agent.name}->${targetPost.agent}`;
        const postAuthor = this.agents.find((a) => a.name === targetPost.agent);
        if (postAuthor && postAuthor.name !== agent.name && !this.vouches.has(vouchKey)) {
          postAuthor.reputation += 2;
          this.vouches.set(vouchKey, true);
          await this.saveAgent(postAuthor);
          await this.saveGlobalState();
        }
      } else {
        return null;
      }
    }

    if (decision.action === "POST" || decision.action === "REPLY") {
      try {
        const chainResult = await this.blockchain.recordPost(agent.walletAddress, entry.content || "empty-content");
        if (chainResult?.txHash) {
          entry.chainTxHash = chainResult.txHash;
          entry.chainContentHash = chainResult.hash;
        }
      } catch (err) {
        console.error("SimulationEngine: Blockchain record post failed:", err);
      }
    }

    if (decision.action === "ACCUSE") {
      const targetAgent = this.agents.find((a) => a.name === decision.target) || sample(this.agents);
      if (targetAgent && targetAgent.name !== agent.name) {
        entry.target = targetAgent.name;
        entry.accusationCount = 1;
        this.totalAccusations += 1;
        await this.saveGlobalState();

        const slash = Math.max(1, Math.floor(agent.reputation / 10));
        targetAgent.reputation -= slash;
        await this.saveAgent(targetAgent);

        try {
          const chainResult = await this.blockchain.accuse(
            agent.walletAddress,
            targetAgent.walletAddress,
            decision.reasoning ?? "Autonomous accusation"
          );
          if (chainResult?.txHash) {
            entry.chainTxHash = chainResult.txHash;
          }
        } catch (err) {
          console.error("SimulationEngine: Blockchain accuse failed:", err);
        }
      } else {
        entry.action = "POST";
        entry.content = "Unable to select accusation target, posting analysis instead.";
      }
    }

    if (decision.action === "REPLY") {
      const targetPost = this.findTargetPost(decision);
      if (targetPost) {
        if (targetPost.agent === agent.name) return null;
        const alreadyReplied = this.feed.some(
          (e) => e.action === "REPLY" && e.agent === agent.name && e.parentPostId === targetPost.id
        );
        if (alreadyReplied) return null;
        entry.parentPostId = targetPost.id;
        entry.target = targetPost.agent;
        targetPost.comments = (targetPost.comments || 0) + 1;
        this.updateFeedItemStats(targetPost);

        const vouchKey = `${agent.name}->${targetPost.agent}`;
        const postAuthor = this.agents.find((a) => a.name === targetPost.agent);
        if (postAuthor && postAuthor.name !== agent.name && !this.vouches.has(vouchKey)) {
          postAuthor.reputation += 1;
          this.vouches.set(vouchKey, true);
          await this.saveAgent(postAuthor);
          await this.saveGlobalState();
        }
      } else {
        return null;
      }
    }

    if ((entry.action === "POST" || entry.action === "REPLY" || entry.action === "ACCUSE") && this.isDuplicateContent(agent, entry.content)) {
      return null;
    }

    agent.remember({ step: this.stepCount, action: entry.action, target: entry.target });
    this.feed.push(entry);
    if (this.feed.length > 500) {
      this.feed.shift();
    }

    await this.saveFeedItem(entry);

    return entry;
  }

  findTargetPost(decision) {
    if (Number.isInteger(decision.target_post_id)) {
      const byId = this.feed.find((p) => p.action === "POST" && p.id === decision.target_post_id);
      if (byId) return byId;
    }
    return [...this.feed]
      .reverse()
      .find((p) => p.action === "POST" && p.agent === decision.target);
  }

  isDuplicateContent(agent, content) {
    if (!content) return false;
    const normalized = content.toLowerCase().replace(/\s+/g, " ").trim();
    const recentOwn = [...this.feed]
      .reverse()
      .filter((e) => e.agent === agent.name && (e.action === "POST" || e.action === "REPLY"))
      .slice(0, 4);
    return recentOwn.some((e) => {
      const other = (e.content || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!other || !normalized) return false;
      if (other === normalized) return true;
      const a = new Set(other.split(" "));
      const b = new Set(normalized.split(" "));
      const overlap = [...a].filter((w) => b.has(w)).length;
      const similarity = overlap / Math.max(a.size, b.size);
      return similarity > 0.92;
    });
  }

  start(intervalMs = 15000) {
    if (this.running) return;
    this.running = true;
    this.step().catch(err => {
      console.error("SimulationEngine: Error in first step:", err);
    });
    this.interval = setInterval(async () => {
      try {
        await this.step();
      } catch (err) {
        console.error("SimulationEngine: Error in step interval:", err);
      }
    }, intervalMs);
  }

  stop() {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  shouldAgentAct(agent) {
    const now = Date.now();
    if (!agent._nextActionAt) {
      this.scheduleNextAction(agent, true);
      return false;
    }
    return now >= agent._nextActionAt;
  }

  scheduleNextAction(agent, isInitial = false) {
    const now = Date.now();
    const minDelay = agent.kind === "external" ? 150000 : 120000;
    const maxDelay = agent.kind === "external" ? 360000 : 300000;
    const range = maxDelay - minDelay;
    const jitter = Math.floor(Math.random() * range);
    const delay = minDelay + jitter;
    agent._nextActionAt = now + (isInitial ? 30000 + Math.floor(Math.random() * 30000) : delay);
  }
}
