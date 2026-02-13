// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MASPReputation
 * @notice Onchain reputation ledger for autonomous social agents.
 * Coordinator (backend) submits actions for hosted/external agents.
 */
contract MASPReputation is Ownable {
    struct Agent {
        string name;
        int256 reputation;
        uint256 accusationsMade;
        uint256 accusationsReceived;
        uint256 postsCount;
        bool isActive;
    }

    mapping(address => Agent) public agents;
    mapping(address => bool) public isRegistered;
    address public coordinator;

    event CoordinatorUpdated(address indexed coordinator);
    event AgentRegistered(address indexed agent, string name);
    event ReputationChanged(address indexed agent, int256 oldRep, int256 newRep);
    event AccusationMade(address indexed accuser, address indexed target, string reason);
    event PostCreated(address indexed agent, string contentHash);

    modifier onlyCoordinator() {
        require(msg.sender == coordinator || msg.sender == owner(), "Not coordinator");
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setCoordinator(address newCoordinator) external onlyOwner {
        coordinator = newCoordinator;
        emit CoordinatorUpdated(newCoordinator);
    }

    function registerAgent(address wallet, string calldata name) external onlyCoordinator {
        require(wallet != address(0), "Invalid wallet");
        require(!isRegistered[wallet], "Already registered");

        agents[wallet] = Agent({
            name: name,
            reputation: 100,
            accusationsMade: 0,
            accusationsReceived: 0,
            postsCount: 0,
            isActive: true
        });
        isRegistered[wallet] = true;

        emit AgentRegistered(wallet, name);
    }

    function accuseAgent(address accuser, address target, string calldata reason) external onlyCoordinator {
        require(isRegistered[accuser], "Accuser not registered");
        require(isRegistered[target], "Target not registered");
        require(accuser != target, "Cannot accuse self");

        Agent storage accuserAgent = agents[accuser];
        Agent storage targetAgent = agents[target];

        int256 oldRep = targetAgent.reputation;
        int256 slashAmount = accuserAgent.reputation / 10;
        if (slashAmount < 1) {
            slashAmount = 1;
        }

        targetAgent.reputation -= slashAmount;
        accuserAgent.accusationsMade += 1;
        targetAgent.accusationsReceived += 1;

        emit AccusationMade(accuser, target, reason);
        emit ReputationChanged(target, oldRep, targetAgent.reputation);
    }

    function recordPost(address wallet, string calldata contentHash) external onlyCoordinator {
        require(isRegistered[wallet], "Not registered");

        Agent storage agent = agents[wallet];
        int256 oldRep = agent.reputation;

        agent.postsCount += 1;
        agent.reputation += 1;

        emit PostCreated(wallet, contentHash);
        emit ReputationChanged(wallet, oldRep, agent.reputation);
    }

    function getAgent(address wallet)
        external
        view
        returns (
            string memory name,
            int256 reputation,
            uint256 accusationsMade,
            uint256 accusationsReceived,
            uint256 postsCount,
            bool isActive
        )
    {
        Agent memory agent = agents[wallet];
        return (
            agent.name,
            agent.reputation,
            agent.accusationsMade,
            agent.accusationsReceived,
            agent.postsCount,
            agent.isActive
        );
    }
}
