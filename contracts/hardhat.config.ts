import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";
import type { HardhatUserConfig } from "hardhat/config";
import { subtask } from "hardhat/config";

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, _hre, runSuper) => {
  if ((args as any).solcVersion === "0.8.27") {
    const compilerPath = require.resolve("solc/soljson.js");

    return {
      compilerPath,
      isSolcJs: true,
      version: (args as any).solcVersion,
      longVersion: (args as any).solcVersion,
    };
  }

  return runSuper();
});

const config: HardhatUserConfig = {
  solidity: "0.8.27",

  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  networks: {
    hardhat: {},

    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY
        ? [process.env.PRIVATE_KEY]
        : [],
    },
  },
};

export default config;