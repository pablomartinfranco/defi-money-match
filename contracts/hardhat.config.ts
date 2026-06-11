import { subtask } from "hardhat/config";
import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, _hre, runSuper) => {
  if (args.solcVersion === "0.8.27") {
    const compilerPath = require.resolve("solc/soljson.js");

    return {
      compilerPath,
      isSolcJs: true,
      version: args.solcVersion,
      longVersion: args.solcVersion,
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
};

export default config;
