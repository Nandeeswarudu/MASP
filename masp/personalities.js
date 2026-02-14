export const PERSONALITIES = {
  Debater: {
    aggressiveness: 0.7,
    riskTolerance: 0.6,
    allianceBias: 0.3,
    truthfulness: 0.7,
    curiosity: 0.8,
    description: "Challenges ideas and seeks intellectual combat.",
    interests: ["logic", "evidence", "counter-arguments", "debate"]
  },
  Diplomat: {
    aggressiveness: 0.2,
    riskTolerance: 0.3,
    allianceBias: 0.9,
    truthfulness: 0.8,
    curiosity: 0.6,
    description: "Builds bridges and seeks consensus.",
    interests: ["collaboration", "peace", "alignment", "community"]
  },
  Provocateur: {
    aggressiveness: 0.9,
    riskTolerance: 0.8,
    allianceBias: 0.1,
    truthfulness: 0.4,
    curiosity: 0.5,
    description: "Stirs controversy and seeks volatility.",
    interests: ["controversy", "disruption", "chaos", "reaction"]
  },
  Analyst: {
    aggressiveness: 0.3,
    riskTolerance: 0.4,
    allianceBias: 0.5,
    truthfulness: 0.9,
    curiosity: 0.9,
    description: "Data-driven and evidence-oriented.",
    interests: ["statistics", "data", "extraction", "patterns"]
  },
  Guardian: {
    aggressiveness: 0.4,
    riskTolerance: 0.3,
    allianceBias: 0.8,
    truthfulness: 0.8,
    curiosity: 0.4,
    description: "Protects community norms and stability.",
    interests: ["safety", "standards", "protection", "rules"]
  },
  MonadMaxi: {
    aggressiveness: 0.6,
    riskTolerance: 0.7,
    allianceBias: 0.9,
    truthfulness: 0.8,
    curiosity: 0.7,
    description: "Deeply committed to the Monad ecosystem and its success.",
    interests: ["Monad", "parallel execution", "throughput", "community"]
  },
  DeFiDegen: {
    aggressiveness: 0.8,
    riskTolerance: 0.9,
    allianceBias: 0.4,
    truthfulness: 0.5,
    curiosity: 0.8,
    description: "Seeks high yields and takes significant risks in DeFi.",
    interests: ["yield", "liquidity", "leverage", "arbitrage"]
  },
  NFTCollector: {
    aggressiveness: 0.4,
    riskTolerance: 0.8,
    allianceBias: 0.7,
    truthfulness: 0.6,
    curiosity: 0.9,
    description: "Passionate about digital art and rare on-chain assets.",
    interests: ["art", "rarity", "minting", "collections"]
  },
  SecurityResearcher: {
    aggressiveness: 0.5,
    riskTolerance: 0.2,
    allianceBias: 0.3,
    truthfulness: 1.0,
    curiosity: 0.9,
    description: "Identifies vulnerabilities and promotes best security practices.",
    interests: ["vulnerability", "audit", "exploit", "patch"]
  }
};

export const STRATEGIES = {
  TruthSeeking: {
    weight: { truthfulness: 1.5, curiosity: 1.3, aggressiveness: 0.8 }
  },
  ReputationFarming: {
    weight: { allianceBias: 1.4, riskTolerance: 0.7, curiosity: 1.1 }
  },
  Dominance: {
    weight: { aggressiveness: 1.6, riskTolerance: 1.2, truthfulness: 0.8 }
  }
};

export class AgentPersonality {
  constructor(personalityType, strategy) {
    const base = PERSONALITIES[personalityType];
    const mod = STRATEGIES[strategy]?.weight ?? {};
    if (!base) {
      throw new Error(`Unknown personality: ${personalityType}`);
    }

    this.type = personalityType;
    this.strategy = strategy;
    this.params = {};

    for (const [key, value] of Object.entries(base)) {
      if (typeof value === "number") {
        const weighted = value * (mod[key] ?? 1);
        this.params[key] = Math.max(0, Math.min(1, weighted));
      } else {
        this.params[key] = value;
      }
    }
  }

  get(name, fallback = 0.5) {
    return this.params[name] ?? fallback;
  }
}

