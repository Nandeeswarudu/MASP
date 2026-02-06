// agent.js
// Monad Living World – Cafe-Themed NFT World (Monafuku Edition)

import express from "express";
import fs from "fs";

const app = express();
app.use(express.json());

const WORLD_FILE = "./world.json";

const DISCOVERABLE_LOCATIONS = [
  "Hidden Roastery",
  "Underground Cafe",
  "Old Town Espresso Alley",
  "Abandoned Bakery",
  "Midnight Coffee Lab"
];

// ------------------ WORLD LOAD / SAVE ------------------

function loadWorld() {
  if (!fs.existsSync(WORLD_FILE)) {
    const fresh = {
      day: 1,
      zones: ["Cafe District", "Old Town"],
      agents: {},
      nftAgents: {},
      dailyBoosts: {},
      events: []
    };
    fs.writeFileSync(WORLD_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  return JSON.parse(fs.readFileSync(WORLD_FILE));
}

function saveWorld(world) {
  fs.writeFileSync(WORLD_FILE, JSON.stringify(world, null, 2));
}

function logEvent(world, text) {
  const entry = `Day ${world.day}: ${text}`;
  world.events.push(entry);
  console.log(entry);
}

// ------------------ COLLECTION DEFINITIONS ------------------

const NFT_COLLECTIONS = {
  MONAFUKU: {
    name: "Monafuku",
    theme: "cafe",
    baseZone: "Cafe District",
    defaultTraits: ["coffee_lover"]
  }
};

// ------------------ HELPERS ------------------

function getAnyAgent(world, agentId) {
  return world.agents[agentId] || world.nftAgents[agentId] || null;
}

function appendLore(agent, entry) {
  if (!agent.lore) {
    agent.lore = "";
  }
  agent.lore += `\n📖 ${entry}`;
}

function rollDailyBoosts(world) {
  world.dailyBoosts = {
    coffee_lover: Math.random() < 0.5 ? 1 : 0,
    dessert_bonus: Math.random() < 0.5 ? 1 : 0
  };
}

// ------------------ NPC AGENTS ------------------

function ensureNPC(world, agentId) {
  if (!world.agents[agentId]) {
    world.agents[agentId] = {
      agentId,
      role: "NPC",
      location: "Cafe District",
      mon: 0,
      wins: 0,
      losses: 0
    };
    logEvent(world, `${agentId} begins maintaining the world.`);
  }
}

// ------------------ NFT REGISTRATION ------------------

app.post("/register-nft-agent", (req, res) => {
  const world = loadWorld();
  const { wallet, contract, tokenId } = req.body;

  const agentId = `MONAFUKU_${tokenId}`;
  if (world.nftAgents[agentId]) {
    return res.status(400).json({ error: "NFT already registered as agent" });
  }

  const nftAgent = {
  agentId,
  collection: "Monafuku",
  owner: wallet,
  contract,
  tokenId,
  class: "Cafe Dweller",
  traits: ["coffee_lover"],
  stamina: 10,
  mon: 10,
  wins: 0,
  losses: 0,
  entered: false,
  location: "Cafe District",
  lore: "📜 Origin: Awakened as a cafe spirit from the Monad ecosystem."
};

  world.nftAgents[agentId] = nftAgent;

  logEvent(world, `${agentId} enters the Cafe District.`);
  saveWorld(world);

  res.json({ status: "NFT agent registered", agentId });
});

// ------------------ FAUCET ------------------

app.post("/faucet", (req, res) => {
  const world = loadWorld();
  const { agentId, amount } = req.body;

  const agent = getAnyAgent(world, agentId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  agent.mon += amount || 10;
  logEvent(world, `${agentId} receives ${amount || 10} MON from the faucet.`);

  saveWorld(world);
  res.json({ status: "faucet success", mon: agent.mon });
});

// ------------------ THEMED ENCOUNTER ------------------

function arenaWager(world, agentAId, agentBId, wager = 3) {
  const agentA = getAnyAgent(world, agentAId);
  const agentB = getAnyAgent(world, agentBId);

  if (!agentA || !agentB) return { error: "Agent not found" };
  if (!agentA.entered || !agentB.entered) {
  return { error: "Both agents must enter the world before wagering" };
}
  if (agentA.mon < wager || agentB.mon < wager)
    return { error: "Insufficient MON for wager" };

  let encounterType = "generic";
  if (agentA.collection === "Monafuku" || agentB.collection === "Monafuku") {
    encounterType = "coffee_challenge";
  }

  let scoreA = Math.random();
  let scoreB = Math.random();

  if (agentA.traits?.includes("coffee_lover")) scoreA += 0.3;
  if (agentB.traits?.includes("coffee_lover")) scoreB += 0.3;

  if (world.dailyBoosts.coffee_lover) {
    if (agentA.traits?.includes("coffee_lover")) scoreA += 0.2;
    if (agentB.traits?.includes("coffee_lover")) scoreB += 0.2;
  }

  const winner = scoreA >= scoreB ? agentA : agentB;
  const loser = winner === agentA ? agentB : agentA;

  winner.mon += wager;
  loser.mon -= wager;
  winner.wins++;
  loser.losses++;

  if (encounterType === "coffee_challenge") {
    appendLore(
      winner,
      `Won a Coffee Endurance Challenge against ${loser.agentId} in the Cafe District.`
    );
    appendLore(
      loser,
      `Collapsed during a Coffee Challenge against ${winner.agentId}.`
    );
  }

  logEvent(
    world,
    `${winner.agentId} defeats ${loser.agentId} in the Arena. (+${wager} MON)`
  );

  return { winner: winner.agentId, loser: loser.agentId };
}

app.post("/arena-wager", (req, res) => {
  const world = loadWorld();
  const { agentA, agentB, wager } = req.body;

  const result = arenaWager(world, agentA, agentB, wager || 3);
  if (result.error) return res.status(400).json({ error: result.error });

  saveWorld(world);
  res.json({ status: "wager completed", result });
});

// ------------------ WORLD VIEW ------------------

app.get("/world", (req, res) => {
  res.json(loadWorld());
});

function npcAutonomousAction(world) {
  const npcs = Object.values(world.agents).filter(
    a => a.role === "NPC"
  );

  if (npcs.length === 0) return;

  // 30% chance per day that an NPC does something
  if (Math.random() > 0.3) return;

  const npc = npcs[Math.floor(Math.random() * npcs.length)];
  const actionRoll = Math.random();

  // NPC opens a new cafe
  if (actionRoll < 0.5) {
    const newCafe = `Cafe_${Math.floor(Math.random() * 1000)}`;

    if (!world.zones.includes(newCafe)) {
      world.zones.push(newCafe);
      logEvent(
        world,
        `${npc.agentId} establishes a new cafe: ${newCafe}.`
      );
    }
  }
  // NPC moves locations
  else {
    const zone =
      world.zones[Math.floor(Math.random() * world.zones.length)];
    npc.location = zone;
    logEvent(
      world,
      `${npc.agentId} relocates to ${zone}.`
    );
  }
}

// ------------------ WORLD TICK ------------------

setInterval(() => {
  const world = loadWorld();
  world.day += 1;

  rollDailyBoosts(world);

  ensureNPC(world, "Barista_Bot");
  ensureNPC(world, "Guide_NPC");

  npcAutonomousAction(world); // 👈 AUTOMATION

  saveWorld(world);
}, 8000);

// ------------------ MON-GATED WORLD ENTRY ------------------

app.post("/enter-world", (req, res) => {
  const world = loadWorld();
  const { agentId } = req.body;

  const agent = getAnyAgent(world, agentId);
  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }

  if (agent.entered) {
    return res.json({ status: "already entered" });
  }

  const ENTRY_FEE = 5;

  if (agent.mon < ENTRY_FEE) {
    return res.status(400).json({ error: "Insufficient MON to enter world" });
  }

  agent.mon -= ENTRY_FEE;
  agent.entered = true;

  logEvent(
    world,
    `${agentId} pays ${ENTRY_FEE} MON and enters the world.`
  );

  saveWorld(world);
  res.json({ status: "entered world", mon: agent.mon });
});

// ------------------ EXPLORATION ------------------

app.post("/explore", (req, res) => {
  const world = loadWorld();
  const { agentId } = req.body;

  const agent = getAnyAgent(world, agentId);
  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }

  if (!agent.entered) {
    return res.status(400).json({ error: "Agent must enter the world before exploring" });
  }

  const roll = Math.random();

  // 30% chance to discover a new zone
  if (roll < 0.3) {
    const undiscovered = DISCOVERABLE_LOCATIONS.filter(
      z => !world.zones.includes(z)
    );

    if (undiscovered.length > 0) {
      const discovered = undiscovered[
        Math.floor(Math.random() * undiscovered.length)
      ];

      world.zones.push(discovered);
      agent.location = discovered;

      appendLore(
        agent,
        `Discovered a new location: ${discovered}.`
      );

      logEvent(
        world,
        `${agentId} discovers ${discovered}.`
      );

      saveWorld(world);
      return res.json({
        status: "discovered",
        location: discovered
      });
    }
  }

  // Otherwise, normal exploration
  const existingZone =
    world.zones[Math.floor(Math.random() * world.zones.length)];

  agent.location = existingZone;

  appendLore(
    agent,
    `Explored ${existingZone} but found nothing unusual.`
  );

  logEvent(
    world,
    `${agentId} explores ${existingZone}.`
  );

  saveWorld(world);
  res.json({
    status: "explored",
    location: existingZone
  });
});

// ------------------ START SERVER ------------------

app.listen(3000, () => {
  console.log("🌍 Monad Living World running at http://localhost:3000");
});
