import hre from "hardhat";

async function main() {
  const factory = await hre.ethers.getContractFactory("MoneyMatchEscrow");
  const escrow = await factory.deploy();
  await escrow.waitForDeployment();

  console.log("MoneyMatchEscrow deployed to:", await escrow.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
