# 🌍 Monad Living World
**World Model Agent – Moltiverse Hackathon**


## Overview

**Monad Living World** is a persistent, autonomous world model where **real Monad NFTs become playable agents** inside a living simulation.  
NPC agents evolve the world automatically over time, while NFT holders can choose to enter, explore, and compete in **narrative-driven encounters** gated by MON.

The system demonstrates **world persistence, agent interaction, autonomy, and emergent behavior**.


## Core Concept

- 🤖 NPC agents autonomously maintain and evolve the world  
- 🎮 NFTs become playable agents with state, traits, and history  
- 🪙 MON-gated entry controls access  
- 🧭 Exploration dynamically expands the world  
- ☕ Themed encounters replace generic combat  
- 📜 Persistent lore records the world’s history  


## Agent Model Clarification

NFTs are represented as **playable agents** within the world model:
- persistent state (location, traits, balances)
- actions via exposed APIs
- influence on world evolution

NPC agents act fully autonomously.


## World Automation

The world advances on a fixed tick:
- days progress automatically
- daily modifiers roll
- NPCs spawn and relocate
- locations may expand

No user interaction is required for evolution.NPC agents make autonomous decisions based on world state and time progression, demonstrating non-deterministic behavior without direct human intervention.


## NFT Agents (Playable Characters)

Canonical collection:
- **Monafuku** (Cafe-themed Monad NFTs)

Each NFT agent has:
- traits (e.g. coffee_lover)
- stamina
- MON balance
- entry status
- location
- win/loss record
- persistent lore

NFTs remain in user wallets.


## MON-Gated Entry

Agents must pay **5 MON** to enter the world.
Entry is required for exploration and encounters.

## Exploration

Exploration allows agents to:
- discover new locations
- move between zones
- generate lore
- expand the world state

Discovery is probabilistic.


## Themed Encounters

Encounters are narrative-driven:
- Coffee Endurance Challenges
- Trait and world-modifier-influenced outcomes
- Winners gain MON, losers lose MON


## Daily World Modifiers

Temporary daily modifiers ensure non-deterministic outcomes and emergent gameplay.


## Persistent Lore

All meaningful actions write permanent lore entries.


## API Endpoints

- POST /register-nft-agent  
- POST /faucet (demo/testing)  
- POST /enter-world  
- POST /explore  
- POST /arena-wager  
- GET /world  


## Quick Test Flow (5 Minutes)

1. Start server: `node agent.js`  
2. Register NFT agent  
3. Fund via faucet  
4. Enter world (MON-gated)  
5. Explore  
6. Optional: themed wager  

World state can be inspected via `GET /world`.


## Autonomous Behavior

Without API calls:
- days advance
- NPCs act and relocate
- events are generated


## Hackathon Mapping

✔ Stateful world  
✔ MON-gated entry  
✔ Multi-agent interaction  
✔ Autonomous evolution  
✔ Emergent behavior  
