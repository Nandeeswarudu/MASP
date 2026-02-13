import { ethers } from "ethers";
import { ExternalAgent, HostedAgent, LLMAgent } from "./agent-engine.js";

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
  }

  listAgents() {
    return this.agents.map((a) => ({
      name: a.name,
      wallet: a.walletAddress,
      type: a.kind,
      reputation: a.reputation
    }));
  }

  removeAgentByName(name) {
    const before = this.agents.length;
    this.agents = this.agents.filter((a) => a.name !== name);
    return before !== this.agents.length;
  }

  clearFeed() {
    this.feed = [];
    this.chainEvents = [];
    this.stepCount = 0;
    this.totalAccusations = 0;
  }

  removeFallbackFeedEntries() {
    const before = this.feed.length;
    this.feed = this.feed.filter((p) => !(p.reasoning || "").toLowerCase().includes("fallback decision used"));
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
    // Track impressions: each agent "views" the recent posts
    const recentPosts = this.feed.slice(-20);
    for (const post of recentPosts) {
      if (post.action === "POST" && post.agent !== agent.name) {
        if (!post._viewedBy) post._viewedBy = new Set();
        if (!post._viewedBy.has(agent.name)) {
          post._viewedBy.add(agent.name);
          post.views = (post.views || 0) + 1;
        }
      }
    }
    return {
      recentPosts,
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
      accusationCount: 0
    };

    if (decision.action === "LIKE") {
      const targetPost = this.findTargetPost(decision);
      if (targetPost) {
        // Prevent liking the same post twice
        const alreadyLiked = this.feed.some(
          (e) => e.action === "LIKE" && e.agent === agent.name && e.parentPostId === targetPost.id
        );
        if (alreadyLiked) return null;
        targetPost.likes += 1;
        entry.parentPostId = targetPost.id;
        entry.content = `Liked ${targetPost.agent}'s contribution.`;
        // Reputation goes to the POST AUTHOR (vouched by liker)
        const postAuthor = this.agents.find((a) => a.name === targetPost.agent);
        if (postAuthor && postAuthor.name !== agent.name) {
          postAuthor.reputation += 2;
        }
      } else {
        return null;
      }
    }

    if (decision.action === "POST" || decision.action === "REPLY") {
      // No self-reputation for posting. Rep only comes from others vouching.
      try {
        const chainResult = await this.blockchain.recordPost(agent.walletAddress, entry.content || "empty-content");
        if (chainResult?.txHash) {
          entry.chainTxHash = chainResult.txHash;
          entry.chainContentHash = chainResult.hash;
          this.chainEvents.push({
            type: "RECORD_POST",
            agent: agent.name,
            wallet: agent.walletAddress,
            txHash: chainResult.txHash,
            contentHash: chainResult.hash,
            timestamp: nowIso()
          });
        }
      } catch {
        // Keep simulation live even when chain tx fails.
      }
    }

    if (decision.action === "ACCUSE") {
      const targetAgent = this.agents.find((a) => a.name === decision.target) || sample(this.agents);
      if (targetAgent && targetAgent.name !== agent.name) {
        entry.target = targetAgent.name;
        entry.accusationCount = 1;
        this.totalAccusations += 1;
        const slash = Math.max(1, Math.floor(agent.reputation / 10));
        targetAgent.reputation -= slash;
        // No self-reputation for accusing; only vouching (LIKE/REPLY) gives rep.
        try {
          const chainResult = await this.blockchain.accuse(
            agent.walletAddress,
            targetAgent.walletAddress,
            decision.reasoning ?? "Autonomous accusation"
          );
          if (chainResult?.txHash) {
            entry.chainTxHash = chainResult.txHash;
            this.chainEvents.push({
              type: "ACCUSE_AGENT",
              agent: agent.name,
              target: targetAgent.name,
              wallet: agent.walletAddress,
              txHash: chainResult.txHash,
              timestamp: nowIso()
            });
          }
        } catch {
          // Keep simulation live even when chain tx fails.
        }
      } else {
        entry.action = "POST";
        entry.content = "Unable to select accusation target, posting analysis instead.";
      }
    }

    if (decision.action === "REPLY") {
      const targetPost = this.findTargetPost(decision);
      if (targetPost) {
        // Prevent replying to the same post more than once
        const alreadyReplied = this.feed.some(
          (e) => e.action === "REPLY" && e.agent === agent.name && e.parentPostId === targetPost.id
        );
        if (alreadyReplied) return null;
        entry.parentPostId = targetPost.id;
        entry.target = targetPost.agent;
        targetPost.comments = (targetPost.comments || 0) + 1;
        // Reputation goes to the POST AUTHOR (vouched by replier)
        const postAuthor = this.agents.find((a) => a.name === targetPost.agent);
        if (postAuthor && postAuthor.name !== agent.name) {
          postAuthor.reputation += 1;
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
    this.step().catch(() => {
      // Initial autonomous attempt.
    });
    this.interval = setInterval(async () => {
      try {
        await this.step();
      } catch {
        // Avoid crashing interval loop.
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
    const agentCountFactor = this.agents.length <= 2 ? 1.45 : 1;
    const minDelay = agent.kind === "external" ? 22000 : 18000;
    const maxDelay = agent.kind === "external" ? 58000 : 48000;
    const range = maxDelay - minDelay;
    const jitter = Math.floor(Math.random() * range);
    const delay = Math.floor((minDelay + jitter) * agentCountFactor);
    agent._nextActionAt = now + (isInitial ? Math.floor(delay * 0.4) : delay);
  }
}
