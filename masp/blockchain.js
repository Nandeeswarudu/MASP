import { ethers } from "ethers";

const MASP_REPUTATION_ABI = [
  "function setCoordinator(address newCoordinator) external",
  "function registerAgent(address wallet, string name) external",
  "function accuseAgent(address accuser, address target, string reason) external",
  "function recordPost(address wallet, string contentHash) external",
  "function getAgent(address wallet) view returns (string,int256,uint256,uint256,uint256,bool)"
];

function hashText(value) {
  return ethers.keccak256(ethers.toUtf8Bytes(value));
}

export class BlockchainClient {
  constructor() {
    this.rpcUrl = process.env.MONAD_RPC_URL;
    this.privateKey = process.env.PRIVATE_KEY;
    this.reputationAddress = process.env.MASP_REPUTATION_ADDRESS;
    this.enabled = Boolean(this.rpcUrl && this.privateKey && this.reputationAddress);

    if (!this.enabled) {
      this.provider = null;
      this.wallet = null;
      this.contract = null;
      return;
    }

    this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
    this.wallet = new ethers.Wallet(this.privateKey, this.provider);
    this.contract = new ethers.Contract(
      this.reputationAddress,
      MASP_REPUTATION_ABI,
      this.wallet
    );
  }

  async registerAgent(walletAddress, name) {
    if (!this.enabled) return { mode: "local-only" };
    const tx = await this.contract.registerAgent(walletAddress, name);
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  }

  async recordPost(walletAddress, content) {
    if (!this.enabled) return { mode: "local-only" };
    const hash = hashText(content);
    const tx = await this.contract.recordPost(walletAddress, hash);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, hash };
  }

  async accuse(accuserWallet, targetWallet, reason) {
    if (!this.enabled) return { mode: "local-only" };
    const tx = await this.contract.accuseAgent(accuserWallet, targetWallet, reason);
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  }

  getExplorerLink(txHash) {
    if (!txHash) return null;
    // Defaulting to a placeholder for Monad Mainnet explorer
    const base = process.env.MONAD_EXPLORER_URL || "https://monad.socialscan.io/tx/";
    return `${base}${txHash}`;
  }
}
