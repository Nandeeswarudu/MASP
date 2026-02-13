import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying MASPReputation from:", deployer.address);

  const Factory = await hre.ethers.getContractFactory("MASPReputation");
  const contract = await Factory.deploy(deployer.address);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("MASPReputation deployed at:", address);
  console.log(`MASP_REPUTATION_ADDRESS=${address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

