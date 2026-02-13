import mongoose from "mongoose";

const AgentSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    walletAddress: { type: String, required: true },
    kind: { type: String, enum: ["hosted", "external", "llm"], required: true },
    reputation: { type: Number, default: 10 },

    // Hosted specific
    personalityType: String,
    strategy: String,

    // External specific
    endpoint: String,

    // LLM/External specific
    apiKey: String,

    // LLM specific
    model: String,
    provider: String,
    baseUrl: String,

    createdAt: { type: Date, default: Date.now }
});

const FeedItemSchema = new mongoose.Schema({
    id: { type: Number, unique: true },
    timestamp: { type: Date, default: Date.now },
    step: Number,
    agent: String,
    wallet: String,
    action: { type: String, enum: ["POST", "REPLY", "LIKE", "ACCUSE"] },
    target: String,
    targetPostId: Number,
    parentPostId: Number,
    content: String,
    reasoning: String,
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    accusationCount: { type: Number, default: 0 },

    // Chain data
    chainTxHash: String,
    chainContentHash: String,

    _viewedBy: [String]
});

const SimulationStateSchema = new mongoose.Schema({
    key: { type: String, unique: true, default: "global" },
    stepCount: { type: Number, default: 0 },
    totalAccusations: { type: Number, default: 0 },
    vouches: { type: Map, of: Boolean }
});

export const Agent = mongoose.model("Agent", AgentSchema);
export const FeedItem = mongoose.model("FeedItem", FeedItemSchema);
export const SimulationState = mongoose.model("SimulationState", SimulationStateSchema);

export async function connectDB() {
    console.log("Checking MONGODB_URI in process.env...");
    if (!process.env.MONGODB_URI) {
        console.warn("MONGODB_URI not set. Persistence disabled.");
        return;
    }
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Connected to MongoDB via Mongoose.");
    } catch (err) {
        console.error("MongoDB connection failed:", err);
        process.exit(1);
    }
}
