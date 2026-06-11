# PROJECT TREE

```text
.
├── .github
│   └── workflows
│       └── deploy.yml
├── contracts
│   ├── scripts
│   │   └── deploy.ts
│   ├── src
│   │   ├── MoneyMatchEscrow.sol
│   │   └── RefundReentrancyAttacker.sol
│   ├── test
│   │   └── MoneyMatchEscrow.ts
│   ├── .env
│   ├── hardhat.config.ts
│   ├── package.json
│   └── tsconfig.json
└── frontend
    ├── src
    │   ├── assets
    │   │   ├── hero.png
    │   │   ├── react.svg
    │   │   └── vite.svg
    │   ├── App.css
    │   ├── App.tsx
    │   ├── escrow.ts
    │   ├── index.css
    │   └── main.tsx
    ├── .env.local
    ├── eslint.config.js
    ├── index.html
    ├── package.json
    ├── tsconfig.app.json
    ├── tsconfig.json
    ├── tsconfig.node.json
    └── vite.config.ts
```

# FILE CONTENTS


# FILE: .github

```plain
# ERROR READING FILE: [Errno 13] Permission denied: '.github'
```


# FILE: .github\workflows\deploy.yml

```plain
name: Deploy to GitHub Pages

on:
  push:
    branches:
      - main

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest

    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Enable pnpm
        run: corepack enable

      - name: Install dependencies
        run: |
          cd frontend
          pnpm install --frozen-lockfile

      - name: Build
        run: |
          cd frontend
          pnpm build

      - name: Setup Pages
        uses: actions/configure-pages@v5

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: frontend/dist

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```


# FILE: contracts\.env

```plain
PRIVATE_KEY=7a7b7d887b625fbe24036ca17c4efa639758465473f3ef227416cfaa532cdf34
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
```


# FILE: contracts\hardhat.config.ts

```plain
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
```


# FILE: contracts\package.json

```plain
{
  "name": "contracts",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "hardhat compile --show-stack-traces",
    "test": "hardhat test",
    "clean": "hardhat clean"
  },
  "devDependencies": {
    "@nomicfoundation/hardhat-toolbox": "^5.0.0",
    "hardhat": "^2.22.16",
    "solc": "0.8.27",
    "ts-node": "^10.9.2",
    "typescript": "^5.6.3"
  },
  "dependencies": {
    "@openzeppelin/contracts": "^5.6.1",
    "dotenv": "^17.4.2"
  }
}

```


# FILE: contracts\scripts\deploy.ts

```plain
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

```


# FILE: contracts\src\MoneyMatchEscrow.sol

```plain
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MoneyMatchEscrow is ReentrancyGuard {
    uint256 public constant REFUND_DELAY = 48 hours;

    enum MatchState {
        WaitingForOpponent,
        Active,
        Resolved,
        Refundable
    }

    struct Match {
        address challenger;
        address opponent;
        uint256 stakeAmount;
        uint256 activationTimestamp;
        bool challengerRefunded;
        bool opponentRefunded;
        MatchState state;
    }

    uint256 public nextMatchId;
    mapping(uint256 => Match) private matches;

    error InvalidStake();
    error InvalidDeposit();
    error MatchNotFound();
    error InvalidState(MatchState current);
    error Unauthorized();
    error InvalidWinner();
    error TooEarlyForRefund();
    error AlreadyRefunded();
    error TransferFailed();

    event MatchCreated(uint256 indexed matchId, address indexed challenger, uint256 stake);
    event ReplayRegistered(uint256 indexed matchId, string replayUrl);
    event MatchJoined(uint256 indexed matchId, address indexed opponent);
    event DefeatConfirmed(uint256 indexed matchId, address indexed loser, address indexed winner);
    event RefundEnabled(uint256 indexed matchId);
    event RefundClaimed(uint256 indexed matchId, address indexed player, uint256 amount);

    function createMatch(uint256 stakeAmount) external payable returns (uint256 matchId) {
        if (stakeAmount == 0) revert InvalidStake();
        if (msg.value != stakeAmount) revert InvalidDeposit();

        matchId = nextMatchId++;

        matches[matchId] = Match({
            challenger: msg.sender,
            opponent: address(0),
            stakeAmount: stakeAmount,
            activationTimestamp: 0,
            challengerRefunded: false,
            opponentRefunded: false,
            state: MatchState.WaitingForOpponent
        });

        emit MatchCreated(matchId, msg.sender, stakeAmount);
    }

    function joinMatch(uint256 matchId) external payable {
        Match storage matchInfo = _getMatch(matchId);

        if (matchInfo.state != MatchState.WaitingForOpponent) revert InvalidState(matchInfo.state);
        if (msg.sender == matchInfo.challenger) revert Unauthorized();
        if (msg.value != matchInfo.stakeAmount) revert InvalidDeposit();

        matchInfo.opponent = msg.sender;
        matchInfo.activationTimestamp = block.timestamp;
        matchInfo.state = MatchState.Active;

        emit MatchJoined(matchId, msg.sender);
    }

    function confirmDefeat(uint256 matchId, address winner, string calldata replayUrl) external nonReentrant {
        Match storage matchInfo = _getMatch(matchId);

        if (matchInfo.state != MatchState.Active) revert InvalidState(matchInfo.state);
        if (!_isParticipant(matchInfo, msg.sender)) revert Unauthorized();
        if (!_isParticipant(matchInfo, winner) || winner == msg.sender) revert InvalidWinner();

        matchInfo.state = MatchState.Resolved;

        uint256 payout = matchInfo.stakeAmount * 2;
        (bool success,) = payable(winner).call{value: payout}("");
        if (!success) revert TransferFailed();

        emit DefeatConfirmed(matchId, msg.sender, winner);
        emit ReplayRegistered(matchId, replayUrl);
    }

    function enableRefund(uint256 matchId) external {
        Match storage matchInfo = _getMatch(matchId);

        if (matchInfo.state != MatchState.Active) revert InvalidState(matchInfo.state);
        if (!_isParticipant(matchInfo, msg.sender)) revert Unauthorized();
        if (block.timestamp < matchInfo.activationTimestamp + REFUND_DELAY) revert TooEarlyForRefund();

        matchInfo.state = MatchState.Refundable;

        emit RefundEnabled(matchId);
    }

    function claimRefund(uint256 matchId) external nonReentrant {
        Match storage matchInfo = _getMatch(matchId);

        if (matchInfo.state != MatchState.Refundable) revert InvalidState(matchInfo.state);
        if (!_isParticipant(matchInfo, msg.sender)) revert Unauthorized();

        uint256 amount = matchInfo.stakeAmount;

        if (msg.sender == matchInfo.challenger) {
            if (matchInfo.challengerRefunded) revert AlreadyRefunded();
            matchInfo.challengerRefunded = true;
        } else {
            if (matchInfo.opponentRefunded) revert AlreadyRefunded();
            matchInfo.opponentRefunded = true;
        }

        (bool success,) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();

        if (matchInfo.challengerRefunded && matchInfo.opponentRefunded) {
            matchInfo.state = MatchState.Resolved;
        }

        emit RefundClaimed(matchId, msg.sender, amount);
    }

    function getMatch(uint256 matchId) external view returns (Match memory) {
        return _getMatch(matchId);
    }

    function _getMatch(uint256 matchId) internal view returns (Match storage matchInfo) {
        matchInfo = matches[matchId];
        if (matchInfo.challenger == address(0)) revert MatchNotFound();
    }

    function _isParticipant(Match storage matchInfo, address player) internal view returns (bool) {
        return player == matchInfo.challenger || player == matchInfo.opponent;
    }
}

```


# FILE: contracts\src\RefundReentrancyAttacker.sol

```plain
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IMoneyMatchEscrow {
    function joinMatch(uint256 matchId) external payable;
    function claimRefund(uint256 matchId) external;
}

contract RefundReentrancyAttacker {
    IMoneyMatchEscrow public immutable escrow;
    uint256 public matchId;
    bool public reentered;
    bool public reentryBlocked;

    constructor(address escrowAddress) {
        escrow = IMoneyMatchEscrow(escrowAddress);
    }

    function joinAsOpponent(uint256 targetMatchId) external payable {
        matchId = targetMatchId;
        escrow.joinMatch{value: msg.value}(targetMatchId);
    }

    function attemptRefundReentrancy() external {
        escrow.claimRefund(matchId);
    }

    receive() external payable {
        if (!reentered) {
            reentered = true;
            try escrow.claimRefund(matchId) {
                // Should never succeed.
            } catch {
                reentryBlocked = true;
            }
        }
    }
}

```


# FILE: contracts\test\MoneyMatchEscrow.ts

```plain
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("MoneyMatchEscrow", function () {
  async function deployFixture() {
    const [challenger, opponent, outsider, attackerOwner] = await (hre.ethers as any).getSigners();

    const escrowFactory = await hre.ethers.getContractFactory("MoneyMatchEscrow");
    const escrow = await escrowFactory.deploy();

    const attackerFactory = await hre.ethers.getContractFactory("RefundReentrancyAttacker");
    const attacker = await attackerFactory.connect(attackerOwner).deploy(await (escrow as any).getAddress());

    return { escrow, attacker, challenger, opponent, outsider, attackerOwner };
  }

  it("runs happy path: create, join, loser confirms, winner paid", async function () {
    const { escrow, challenger, opponent } = await loadFixture(deployFixture);
    const stake = hre.ethers.parseEther("1");

    await expect(
      escrow.connect(challenger).createMatch(stake, { value: stake })
    )
      .to.emit(escrow, "MatchCreated")
      .withArgs(0, challenger.address, stake);

    await expect(escrow.connect(opponent).joinMatch(0, { value: stake }))
      .to.emit(escrow, "MatchJoined")
      .withArgs(0, opponent.address);

    await expect(() => escrow.connect(challenger).confirmDefeat(0, opponent.address, "https://replays.example/match-1")).to.changeEtherBalances(
      [challenger, opponent],
      [0n, stake * 2n]
    );

    const matchInfo = await escrow.getMatch(0);
    expect(matchInfo.state).to.equal(2n);
  });

  it("enables refunds after timelock and each player gets own deposit", async function () {
    const { escrow, challenger, opponent } = await loadFixture(deployFixture);
    const stake = hre.ethers.parseEther("0.5");

    await escrow.connect(challenger).createMatch(stake, { value: stake });
    await escrow.connect(opponent).joinMatch(0, { value: stake });

    await time.increase(48 * 60 * 60 + 1);

    await expect(escrow.connect(challenger).enableRefund(0)).to.emit(escrow, "RefundEnabled").withArgs(0);

    await expect(() => escrow.connect(challenger).claimRefund(0)).to.changeEtherBalances([challenger], [stake]);
    await expect(() => escrow.connect(opponent).claimRefund(0)).to.changeEtherBalances([opponent], [stake]);

    const matchInfo = await escrow.getMatch(0);
    expect(matchInfo.challengerRefunded).to.equal(true);
    expect(matchInfo.opponentRefunded).to.equal(true);
    expect(matchInfo.state).to.equal(2n);
  });

  it("blocks unauthorized and invalid result actions", async function () {
    const { escrow, challenger, opponent, outsider } = await loadFixture(deployFixture);
    const stake = hre.ethers.parseEther("1");

    await escrow.connect(challenger).createMatch(stake, { value: stake });
    await escrow.connect(opponent).joinMatch(0, { value: stake });

    await expect(escrow.connect(outsider).confirmDefeat(0, challenger.address, "https://replays.example/match-1")).to.be.revertedWithCustomError(
      escrow,
      "Unauthorized"
    );

    await expect(escrow.connect(challenger).confirmDefeat(0, challenger.address, "https://replays.example/match-1")).to.be.revertedWithCustomError(
      escrow,
      "InvalidWinner"
    );

    await escrow.connect(challenger).confirmDefeat(0, opponent.address, "https://replays.example/match-1");

    await expect(escrow.connect(opponent).confirmDefeat(0, challenger.address, "https://replays.example/match-1")).to.be.revertedWithCustomError(
      escrow,
      "InvalidState"
    );
  });

  it("prevents double refund claims", async function () {
    const { escrow, challenger, opponent } = await loadFixture(deployFixture);
    const stake = hre.ethers.parseEther("0.2");

    await escrow.connect(challenger).createMatch(stake, { value: stake });
    await escrow.connect(opponent).joinMatch(0, { value: stake });

    await time.increase(48 * 60 * 60 + 1);
    await escrow.connect(opponent).enableRefund(0);

    await escrow.connect(challenger).claimRefund(0);

    await expect(escrow.connect(challenger).claimRefund(0)).to.be.revertedWithCustomError(escrow, "AlreadyRefunded");
  });

  it("blocks a reentrancy attempt during refund", async function () {
    const { escrow, attacker, challenger, attackerOwner } = await loadFixture(deployFixture);
    const stake = hre.ethers.parseEther("0.4");

    await escrow.connect(challenger).createMatch(stake, { value: stake });
    await attacker.connect(attackerOwner).joinAsOpponent(0, { value: stake });

    await time.increase(48 * 60 * 60 + 1);
    await escrow.connect(challenger).enableRefund(0);

    await attacker.connect(attackerOwner).attemptRefundReentrancy();

    expect(await attacker.reentryBlocked()).to.equal(true);

    await expect(attacker.connect(attackerOwner).attemptRefundReentrancy()).to.be.revertedWithCustomError(
      escrow,
      "AlreadyRefunded"
    );
  });
});

```


# FILE: contracts\tsconfig.json

```plain
{
  "compilerOptions": {
    "target": "es2020",
    "module": "commonjs",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  }
}

```


# FILE: frontend\.env.local

```plain
# ERROR READING FILE: 'utf-8' codec can't decode byte 0xff in position 0: invalid start byte
```


# FILE: frontend\eslint.config.js

```plain
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
])

```


# FILE: frontend\index.html

```plain
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>frontend</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>

```


# FILE: frontend\package.json

```plain
{
  "name": "frontend",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "homepage": "https://pablomartinfranco.github.io/defi-money-match/",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "deploy": "gh-pages -d dist"
  },
  "dependencies": {
    "ethers": "^6",
    "react": "^19.2.6",
    "react-dom": "^19.2.6"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/node": "^24.12.3",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "eslint": "^10.3.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.2",
    "gh-pages": "^6.3.0",
    "globals": "^17.6.0",
    "typescript": "~6.0.2",
    "typescript-eslint": "^8.59.2",
    "vite": "^8.0.12"
  }
}

```


# FILE: frontend\src\App.css

```plain
/* .app {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
} */

.app {
  width: 900px;
  max-width: 100%;
  min-width: 0;
  margin: 0 auto;
  padding: 2rem;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
  box-sizing: border-box;
}

/* section {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 1rem;
  display: grid;
  gap: 0.5rem;
} */

section {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 1rem;
  display: grid;
  gap: 0.5rem;
  min-width: 0;      
  overflow: hidden;  
  box-sizing: border-box;
}

.feedback-section {
  min-width: 0;
  overflow: hidden;
}

pre.feedback {
  margin: 0;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-all;
  box-sizing: border-box;
  text-align: left;
}

input,
button {
  padding: 0.5rem;
}

.actions-row {
  display: flex;
  gap: 0.5rem;
}

```


# FILE: frontend\src\App.tsx

```plain
import { BrowserProvider, Contract, ethers } from "ethers";
import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { ESCROW_ABI, MATCH_STATE_LABELS, REFUND_DELAY_SECONDS } from "./escrow";

type MatchData = {
  challenger: string;
  opponent: string;
  stakeAmount: bigint;
  activationTimestamp: bigint;
  challengerRefunded: boolean;
  opponentRefunded: boolean;
  state: number;
};

declare global {
  interface Window {
    ethereum?: {
      on?: (event: string, cb: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
    };
  }
}

function App() {
  const VISIBLE_REFUND = false;
  // const ENV_CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS ?? "";
  // const ENV_CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const ENV_CONTRACT_ADDRESS = "0x24C9D7a9AF86905A81262a07ca41B69437C99804";
  console.log("Using contract address:", import.meta.env.VITE_CONTRACT_ADDRESS ?? "");
  
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [contractAddress, setContractAddress] = useState(ENV_CONTRACT_ADDRESS);

  const [createStake, setCreateStake] = useState("0.01");
  const [joinMatchId, setJoinMatchId] = useState("0");
  const [confirmMatchId, setConfirmMatchId] = useState("0");
  const [winnerAddress, setWinnerAddress] = useState("");
  const [refundMatchId, setRefundMatchId] = useState("0");
  const [statusMatchId, setStatusMatchId] = useState("0");
  const [createdMatchId, setCreatedMatchId] = useState<string>("");
  const [joinedMatchId, setJoinedMatchId] = useState<string>("");

  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [replayUrl, setReplayUrl] = useState("");
  const [feedback, setFeedback] = useState("");
  const [now, setNow] = useState<number>(0);

  const contract = useMemo(() => {
    if (!provider || !contractAddress) return null;
    return new Contract(contractAddress, ESCROW_ABI, provider);
  }, [provider, contractAddress]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts: unknown) => {
      const values = Array.isArray(accounts) ? accounts : [];
      setWalletAddress(typeof values[0] === "string" ? values[0] : "");
    };

    const handleChainChanged = () => {
      window.location.reload();
    };

    window.ethereum.on?.("accountsChanged", handleAccountsChanged);
    window.ethereum.on?.("chainChanged", handleChainChanged);

    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  const connectWallet = async () => {
    if (!window.ethereum) {
      setFeedback("MetaMask not detected.");
      return;
    }

    const nextProvider = new BrowserProvider(window.ethereum as ethers.Eip1193Provider);
    const signer = await nextProvider.getSigner();
    setProvider(nextProvider);
    setWalletAddress(await signer.getAddress());
    setFeedback("Wallet connected.");
  };

  const loadMatch = async () => {
    if (!contract) return;

    const id = BigInt(statusMatchId);
    const data = await contract.getMatch(id);

    setMatchData({
      challenger: data.challenger,
      opponent: data.opponent,
      stakeAmount: data.stakeAmount,
      activationTimestamp: data.activationTimestamp,
      challengerRefunded: data.challengerRefunded,
      opponentRefunded: data.opponentRefunded,
      state: Number(data.state),
    });

    const filter = contract.filters.ReplayRegistered(id);
    const events = await contract.queryFilter(filter, 0, "latest");
    const latest = events.at(-1);
    if (latest && "args" in latest) {
      setReplayUrl(String(latest.args?.replayUrl ?? ""));
      return;
    }

    setReplayUrl("");
  };

  const withWrite = async (fn: (writeContract: Contract) => Promise<void>) => {
    if (!contract || !provider) {
      setFeedback("Connect wallet and set contract address first.");
      return;
    }

    const signer = await provider.getSigner();
    const writeContract = contract.connect(signer) as Contract;

    try {
      await fn(writeContract);
      setFeedback("Transaction confirmed.");
      await loadMatch();
    } catch (error) {
      setFeedback(`Transaction failed: ${(error as Error).message}`);
    }
  };

  type ParsedLog = { topics: ReadonlyArray<string>; data: string; };
  type Event = { name: string; };

  const createMatch = async () => {
    await withWrite(async (writeContract) => {
      const stake = ethers.parseEther(createStake);
      const tx = await writeContract.createMatch(stake, { value: stake });
      const receipt = await tx.wait();

      const parsed = receipt?.logs
        .map((log: ParsedLog) => writeContract.interface.parseLog(log))
        .find((e: Event) => e?.name === "MatchCreated");
      const matchId = parsed?.args?.matchId?.toString();
      setCreatedMatchId(matchId);
      setFeedback(`Match created! ID: ${matchId}`);
    });
  };

  const joinMatch = async () => {
    await withWrite(async (writeContract) => {
      const id = BigInt(joinMatchId);
      const data = await writeContract.getMatch(id);
      const tx = await writeContract.joinMatch(id, { value: data.stakeAmount });
      const receipt = await tx.wait();

      const parsed = receipt?.logs
        .map((log: ParsedLog) => writeContract.interface.parseLog(log))
        .find((e: Event) => e?.name === "MatchJoined");
      const joinedId = parsed?.args?.matchId?.toString();
      setJoinedMatchId(joinedId);
      setFeedback(`Joined match ID: ${joinedId}`);
    });
  };

  const confirmDefeat = async () => {
    await withWrite(async (writeContract) => {
      const tx = await writeContract.confirmDefeat(BigInt(confirmMatchId), winnerAddress, replayUrl);
      await tx.wait();
    });
  };

  const claimRefund = async () => {
    await withWrite(async (writeContract) => {
      const tx = await writeContract.claimRefund(BigInt(refundMatchId));
      await tx.wait();
    });
  };

  const enableRefund = async () => {
    await withWrite(async (writeContract) => {
      const tx = await writeContract.enableRefund(BigInt(refundMatchId));
      await tx.wait();
    });
  };

  const timeUntilRefund = (() => {
    if (!matchData || matchData.state !== 1 || matchData.activationTimestamp === 0n) return 0;
    const unlockAt = Number(matchData.activationTimestamp) + REFUND_DELAY_SECONDS;
    return Math.max(0, unlockAt - now);
  })();

  const canClaimRefund = (() => {
    if (!matchData || !walletAddress || matchData.state !== 3) return false;

    if (walletAddress.toLowerCase() === matchData.challenger.toLowerCase()) {
      return !matchData.challengerRefunded;
    }

    if (walletAddress.toLowerCase() === matchData.opponent.toLowerCase()) {
      return !matchData.opponentRefunded;
    }

    return false;
  })();

  return (
    <main className="app">
      <h1>MoneyMatch Escrow</h1>

      <section>
        <h2>Contract {ENV_CONTRACT_ADDRESS ?? ""}</h2>
        {!ENV_CONTRACT_ADDRESS && (
          <input value={contractAddress} onChange={(e) => setContractAddress(e.target.value)} placeholder="0x..." />
        )}
        <button onClick={connectWallet}>Connect MetaMask</button>
        <p>Wallet: {walletAddress ?? "Not connected"}</p>
      </section>

      <section>
        <h2>Create Match</h2>
        <input value={createStake} onChange={(e) => setCreateStake(e.target.value)} placeholder="Stake in ETH" />
        <button onClick={createMatch}>Create + Deposit</button>
        {createdMatchId && (
          <p>Created Match ID: {createdMatchId}</p>
        )}
      </section>

      <section>
        <h2>Join Match</h2>
        <input value={joinMatchId} onChange={(e) => setJoinMatchId(e.target.value)} placeholder="Match ID" />
        <button onClick={joinMatch}>Join + Deposit</button>
        {joinedMatchId && (
          <p>Joined Match ID: {joinedMatchId}</p>
        )}
      </section>

      <section>
        <h2>Confirm Defeat</h2>
        <input value={confirmMatchId} onChange={(e) => setConfirmMatchId(e.target.value)} placeholder="Match ID" />
        <input value={winnerAddress} onChange={(e) => setWinnerAddress(e.target.value)} placeholder="Winner Address" />
        <input value={replayUrl} onChange={(e) => setReplayUrl(e.target.value)} placeholder="Replay URL" />
        <button onClick={confirmDefeat}>Confirm Defeat</button>
      </section>

      {VISIBLE_REFUND && (
        <section>
          <h2>Refund</h2>
          <input value={refundMatchId} onChange={(e) => setRefundMatchId(e.target.value)} placeholder="Match ID" />
          <div className="actions-row">
            <button onClick={enableRefund}>Enable Refund</button>
            <button onClick={claimRefund}>Claim Refund</button>
          </div>
        </section>
      )}

      <section>
        <h2>Match Status</h2>
        <input value={statusMatchId} onChange={(e) => setStatusMatchId(e.target.value)} placeholder="Match ID" />
        <button onClick={loadMatch}>Load Match</button>
        {matchData && (
          <div>
            <p>State: {MATCH_STATE_LABELS[matchData.state]}</p>
            <p>Stake: {ethers.formatEther(matchData.stakeAmount)} ETH</p>
            <p>Replay URL (from logs): {replayUrl || "Not found"}</p>
            <p>Resolved: {matchData.state === 2 ? "Yes" : "No"}</p>
            <p>Can claim refund: {canClaimRefund ? "Yes" : "No"}</p>
            <p>
              Refund timer: {timeUntilRefund > 0 ? `${timeUntilRefund}s remaining` : "Eligible or not active"}
            </p>
          </div>
        )}
      </section>

      {feedback && (
        <section className="feedback-section">
          <h2>Feedback Logs</h2>
          <pre className="feedback">{feedback}</pre>
        </section>
      )}
    </main>
  );
}

export default App;

```


# FILE: frontend\src\assets\hero.png

```plain
# ERROR READING FILE: 'utf-8' codec can't decode byte 0x89 in position 0: invalid start byte
```


# FILE: frontend\src\assets\react.svg

```plain
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" class="iconify iconify--logos" width="35.93" height="32" preserveAspectRatio="xMidYMid meet" viewBox="0 0 256 228"><path fill="#00D8FF" d="M210.483 73.824a171.49 171.49 0 0 0-8.24-2.597c.465-1.9.893-3.777 1.273-5.621c6.238-30.281 2.16-54.676-11.769-62.708c-13.355-7.7-35.196.329-57.254 19.526a171.23 171.23 0 0 0-6.375 5.848a155.866 155.866 0 0 0-4.241-3.917C100.759 3.829 77.587-4.822 63.673 3.233C50.33 10.957 46.379 33.89 51.995 62.588a170.974 170.974 0 0 0 1.892 8.48c-3.28.932-6.445 1.924-9.474 2.98C17.309 83.498 0 98.307 0 113.668c0 15.865 18.582 31.778 46.812 41.427a145.52 145.52 0 0 0 6.921 2.165a167.467 167.467 0 0 0-2.01 9.138c-5.354 28.2-1.173 50.591 12.134 58.266c13.744 7.926 36.812-.22 59.273-19.855a145.567 145.567 0 0 0 5.342-4.923a168.064 168.064 0 0 0 6.92 6.314c21.758 18.722 43.246 26.282 56.54 18.586c13.731-7.949 18.194-32.003 12.4-61.268a145.016 145.016 0 0 0-1.535-6.842c1.62-.48 3.21-.974 4.76-1.488c29.348-9.723 48.443-25.443 48.443-41.52c0-15.417-17.868-30.326-45.517-39.844Zm-6.365 70.984c-1.4.463-2.836.91-4.3 1.345c-3.24-10.257-7.612-21.163-12.963-32.432c5.106-11 9.31-21.767 12.459-31.957c2.619.758 5.16 1.557 7.61 2.4c23.69 8.156 38.14 20.213 38.14 29.504c0 9.896-15.606 22.743-40.946 31.14Zm-10.514 20.834c2.562 12.94 2.927 24.64 1.23 33.787c-1.524 8.219-4.59 13.698-8.382 15.893c-8.067 4.67-25.32-1.4-43.927-17.412a156.726 156.726 0 0 1-6.437-5.87c7.214-7.889 14.423-17.06 21.459-27.246c12.376-1.098 24.068-2.894 34.671-5.345a134.17 134.17 0 0 1 1.386 6.193ZM87.276 214.515c-7.882 2.783-14.16 2.863-17.955.675c-8.075-4.657-11.432-22.636-6.853-46.752a156.923 156.923 0 0 1 1.869-8.499c10.486 2.32 22.093 3.988 34.498 4.994c7.084 9.967 14.501 19.128 21.976 27.15a134.668 134.668 0 0 1-4.877 4.492c-9.933 8.682-19.886 14.842-28.658 17.94ZM50.35 144.747c-12.483-4.267-22.792-9.812-29.858-15.863c-6.35-5.437-9.555-10.836-9.555-15.216c0-9.322 13.897-21.212 37.076-29.293c2.813-.98 5.757-1.905 8.812-2.773c3.204 10.42 7.406 21.315 12.477 32.332c-5.137 11.18-9.399 22.249-12.634 32.792a134.718 134.718 0 0 1-6.318-1.979Zm12.378-84.26c-4.811-24.587-1.616-43.134 6.425-47.789c8.564-4.958 27.502 2.111 47.463 19.835a144.318 144.318 0 0 1 3.841 3.545c-7.438 7.987-14.787 17.08-21.808 26.988c-12.04 1.116-23.565 2.908-34.161 5.309a160.342 160.342 0 0 1-1.76-7.887Zm110.427 27.268a347.8 347.8 0 0 0-7.785-12.803c8.168 1.033 15.994 2.404 23.343 4.08c-2.206 7.072-4.956 14.465-8.193 22.045a381.151 381.151 0 0 0-7.365-13.322Zm-45.032-43.861c5.044 5.465 10.096 11.566 15.065 18.186a322.04 322.04 0 0 0-30.257-.006c4.974-6.559 10.069-12.652 15.192-18.18ZM82.802 87.83a323.167 323.167 0 0 0-7.227 13.238c-3.184-7.553-5.909-14.98-8.134-22.152c7.304-1.634 15.093-2.97 23.209-3.984a321.524 321.524 0 0 0-7.848 12.897Zm8.081 65.352c-8.385-.936-16.291-2.203-23.593-3.793c2.26-7.3 5.045-14.885 8.298-22.6a321.187 321.187 0 0 0 7.257 13.246c2.594 4.48 5.28 8.868 8.038 13.147Zm37.542 31.03c-5.184-5.592-10.354-11.779-15.403-18.433c4.902.192 9.899.29 14.978.29c5.218 0 10.376-.117 15.453-.343c-4.985 6.774-10.018 12.97-15.028 18.486Zm52.198-57.817c3.422 7.8 6.306 15.345 8.596 22.52c-7.422 1.694-15.436 3.058-23.88 4.071a382.417 382.417 0 0 0 7.859-13.026a347.403 347.403 0 0 0 7.425-13.565Zm-16.898 8.101a358.557 358.557 0 0 1-12.281 19.815a329.4 329.4 0 0 1-23.444.823c-7.967 0-15.716-.248-23.178-.732a310.202 310.202 0 0 1-12.513-19.846h.001a307.41 307.41 0 0 1-10.923-20.627a310.278 310.278 0 0 1 10.89-20.637l-.001.001a307.318 307.318 0 0 1 12.413-19.761c7.613-.576 15.42-.876 23.31-.876H128c7.926 0 15.743.303 23.354.883a329.357 329.357 0 0 1 12.335 19.695a358.489 358.489 0 0 1 11.036 20.54a329.472 329.472 0 0 1-11 20.722Zm22.56-122.124c8.572 4.944 11.906 24.881 6.52 51.026c-.344 1.668-.73 3.367-1.15 5.09c-10.622-2.452-22.155-4.275-34.23-5.408c-7.034-10.017-14.323-19.124-21.64-27.008a160.789 160.789 0 0 1 5.888-5.4c18.9-16.447 36.564-22.941 44.612-18.3ZM128 90.808c12.625 0 22.86 10.235 22.86 22.86s-10.235 22.86-22.86 22.86s-22.86-10.235-22.86-22.86s10.235-22.86 22.86-22.86Z"></path></svg>
```


# FILE: frontend\src\assets\vite.svg

```plain
<svg xmlns="http://www.w3.org/2000/svg" width="77" height="47" fill="none" aria-labelledby="vite-logo-title" viewBox="0 0 77 47"><title id="vite-logo-title">Vite</title><style>.parenthesis{fill:#000}@media (prefers-color-scheme:dark){.parenthesis{fill:#fff}}</style><path fill="#9135ff" d="M40.151 45.71c-.663.844-2.02.374-2.02-.699V34.708a2.26 2.26 0 0 0-2.262-2.262H24.493c-.92 0-1.457-1.04-.92-1.788l7.479-10.471c1.07-1.498 0-3.578-1.842-3.578H15.443c-.92 0-1.456-1.04-.92-1.788l9.696-13.576c.213-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.472c-1.07 1.497 0 3.578 1.842 3.578h11.376c.944 0 1.474 1.087.89 1.83L40.153 45.712z"/><mask id="a" width="48" height="47" x="14" y="0" maskUnits="userSpaceOnUse" style="mask-type:alpha"><path fill="#000" d="M40.047 45.71c-.663.843-2.02.374-2.02-.699V34.708a2.26 2.26 0 0 0-2.262-2.262H24.389c-.92 0-1.457-1.04-.92-1.788l7.479-10.472c1.07-1.497 0-3.578-1.842-3.578H15.34c-.92 0-1.456-1.04-.92-1.788l9.696-13.575c.213-.297.556-.474.92-.474H53.93c.92 0 1.456 1.04.92 1.788L47.37 13.03c-1.07 1.498 0 3.578 1.842 3.578h11.376c.944 0 1.474 1.088.89 1.831L40.049 45.712z"/></mask><g mask="url(#a)"><g filter="url(#b)"><ellipse cx="5.508" cy="14.704" fill="#eee6ff" rx="5.508" ry="14.704" transform="rotate(269.814 20.96 11.29)scale(-1 1)"/></g><g filter="url(#c)"><ellipse cx="10.399" cy="29.851" fill="#eee6ff" rx="10.399" ry="29.851" transform="rotate(89.814 -16.902 -8.275)scale(1 -1)"/></g><g filter="url(#d)"><ellipse cx="5.508" cy="30.487" fill="#8900ff" rx="5.508" ry="30.487" transform="rotate(89.814 -19.197 -7.127)scale(1 -1)"/></g><g filter="url(#e)"><ellipse cx="5.508" cy="30.599" fill="#8900ff" rx="5.508" ry="30.599" transform="rotate(89.814 -25.928 4.177)scale(1 -1)"/></g><g filter="url(#f)"><ellipse cx="5.508" cy="30.599" fill="#8900ff" rx="5.508" ry="30.599" transform="rotate(89.814 -25.738 5.52)scale(1 -1)"/></g><g filter="url(#g)"><ellipse cx="14.072" cy="22.078" fill="#eee6ff" rx="14.072" ry="22.078" transform="rotate(93.35 31.245 55.578)scale(-1 1)"/></g><g filter="url(#h)"><ellipse cx="3.47" cy="21.501" fill="#8900ff" rx="3.47" ry="21.501" transform="rotate(89.009 35.419 55.202)scale(-1 1)"/></g><g filter="url(#i)"><ellipse cx="3.47" cy="21.501" fill="#8900ff" rx="3.47" ry="21.501" transform="rotate(89.009 35.419 55.202)scale(-1 1)"/></g><g filter="url(#j)"><ellipse cx="14.592" cy="9.743" fill="#8900ff" rx="4.407" ry="29.108" transform="rotate(39.51 14.592 9.743)"/></g><g filter="url(#k)"><ellipse cx="61.728" cy="-5.321" fill="#8900ff" rx="4.407" ry="29.108" transform="rotate(37.892 61.728 -5.32)"/></g><g filter="url(#l)"><ellipse cx="55.618" cy="7.104" fill="#00c2ff" rx="5.971" ry="9.665" transform="rotate(37.892 55.618 7.104)"/></g><g filter="url(#m)"><ellipse cx="12.326" cy="39.103" fill="#8900ff" rx="4.407" ry="29.108" transform="rotate(37.892 12.326 39.103)"/></g><g filter="url(#n)"><ellipse cx="12.326" cy="39.103" fill="#8900ff" rx="4.407" ry="29.108" transform="rotate(37.892 12.326 39.103)"/></g><g filter="url(#o)"><ellipse cx="49.857" cy="30.678" fill="#8900ff" rx="4.407" ry="29.108" transform="rotate(37.892 49.857 30.678)"/></g><g filter="url(#p)"><ellipse cx="52.623" cy="33.171" fill="#00c2ff" rx="5.971" ry="15.297" transform="rotate(37.892 52.623 33.17)"/></g></g><path d="M6.919 0c-9.198 13.166-9.252 33.575 0 46.789h6.215c-9.25-13.214-9.196-33.623 0-46.789zm62.424 0h-6.215c9.198 13.166 9.252 33.575 0 46.789h6.215c9.25-13.214 9.196-33.623 0-46.789" class="parenthesis"/><defs><filter id="b" width="60.045" height="41.654" x="-5.564" y="16.92" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_2002_17286" stdDeviation="7.659"/></filter><filter id="c" width="90.34" height="51.437" x="-40.407" y="-6.762" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_2002_17286" stdDeviation="7.659"/></filter><filter id="d" width="79.355" height="29.4" x="-35.435" y="2.801" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_2002_17286" stdDeviation="4.596"/></filter><filter id="e" width="79.579" height="29.4" x="-30.84" y="20.8" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_2002_17286" stdDeviation="4.596"/></filter><filter id="f" width="79.579" height="29.4" x="-29.307" y="21.949" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_2002_17286" stdDeviation="4.596"/></filter><filter id="g" width="74.749" height="58.852" x="29.961" y="-17.13" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_2002_17286" stdDeviation="7.659"/></filter><filter id="h" width="61.377" height="25.362" x="37.754" y="3.055" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_2002_17286" stdDeviation="4.596"/></filter><filter id="i" width="61.377" height="25.362" x="37.754" y="3.055" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_2002_17286" stdDeviation="4.596"/></filter><filter id="j" width="56.045" height="63.649" x="-13.43" y="-22.082" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_2002_17286" stdDeviation="4.596"/></filter><filter id="k" width="54.814" height="64.646" x="34.321" y="-37.644" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_2002_17286" stdDeviation="4.596"/></filter><filter id="l" width="33.541" height="35.313" x="38.847" y="-10.552" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_2002_17286" stdDeviation="4.596"/></filter><filter id="m" width="54.814" height="64.646" x="-15.081" y="6.78" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_2002_17286" stdDeviation="4.596"/></filter><filter id="n" width="54.814" height="64.646" x="-15.081" y="6.78" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_2002_17286" stdDeviation="4.596"/></filter><filter id="o" width="54.814" height="64.646" x="22.45" y="-1.645" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_2002_17286" stdDeviation="4.596"/></filter><filter id="p" width="39.409" height="43.623" x="32.919" y="11.36" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_2002_17286" stdDeviation="4.596"/></filter></defs></svg>

```


# FILE: frontend\src\escrow.ts

```plain
export const ESCROW_ABI = [
  "function createMatch(uint256 stakeAmount) payable returns (uint256)",
  "function joinMatch(uint256 matchId) payable",
  "function confirmDefeat(uint256 matchId, address winner, string replayUrl)",
  "function enableRefund(uint256 matchId)",
  "function claimRefund(uint256 matchId)",
  "function getMatch(uint256 matchId) view returns (tuple(address challenger, address opponent, uint256 stakeAmount, uint256 activationTimestamp, bool challengerRefunded, bool opponentRefunded, uint8 state))",
  "event MatchCreated(uint256 indexed matchId, address indexed challenger, uint256 stake)",
  "event MatchJoined(uint256 indexed matchId, address indexed opponent)",
  "event ReplayRegistered(uint256 indexed matchId, string replayUrl)",
] as const;

export const MATCH_STATE_LABELS: Record<number, string> = {
  0: "Waiting for opponent",
  1: "Active",
  2: "Resolved",
  3: "Refund available",
};

export const REFUND_DELAY_SECONDS = 48 * 60 * 60;

```


# FILE: frontend\src\index.css

```plain
:root {
  --text: #6b6375;
  --text-h: #08060d;
  --bg: #fff;
  --border: #e5e4e7;
  --code-bg: #f4f3ec;
  --accent: #aa3bff;
  --accent-bg: rgba(170, 59, 255, 0.1);
  --accent-border: rgba(170, 59, 255, 0.5);
  --social-bg: rgba(244, 243, 236, 0.5);
  --shadow:
    rgba(0, 0, 0, 0.1) 0 10px 15px -3px, rgba(0, 0, 0, 0.05) 0 4px 6px -2px;

  --sans: system-ui, 'Segoe UI', Roboto, sans-serif;
  --heading: system-ui, 'Segoe UI', Roboto, sans-serif;
  --mono: ui-monospace, Consolas, monospace;

  font: 18px/145% var(--sans);
  letter-spacing: 0.18px;
  color-scheme: light dark;
  color: var(--text);
  background: var(--bg);
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;

  @media (max-width: 1024px) {
    font-size: 16px;
  }
}

@media (prefers-color-scheme: dark) {
  :root {
    --text: #9ca3af;
    --text-h: #f3f4f6;
    --bg: #16171d;
    --border: #2e303a;
    --code-bg: #1f2028;
    --accent: #c084fc;
    --accent-bg: rgba(192, 132, 252, 0.15);
    --accent-border: rgba(192, 132, 252, 0.5);
    --social-bg: rgba(47, 48, 58, 0.5);
    --shadow:
      rgba(0, 0, 0, 0.4) 0 10px 15px -3px, rgba(0, 0, 0, 0.25) 0 4px 6px -2px;
  }

  #social .button-icon {
    filter: invert(1) brightness(2);
  }
}

#root {
  width: 1126px;
  max-width: 100%;
  margin: 0 auto;
  text-align: center;
  border-inline: 1px solid var(--border);
  min-height: 100svh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

body {
  margin: 0;
}

h1,
h2 {
  font-family: var(--heading);
  font-weight: 500;
  color: var(--text-h);
}

h1 {
  font-size: 56px;
  letter-spacing: -1.68px;
  margin: 32px 0;
  @media (max-width: 1024px) {
    font-size: 36px;
    margin: 20px 0;
  }
}
h2 {
  font-size: 24px;
  line-height: 118%;
  letter-spacing: -0.24px;
  margin: 0 0 8px;
  @media (max-width: 1024px) {
    font-size: 20px;
  }
}
p {
  margin: 0;
}

code,
.counter {
  font-family: var(--mono);
  display: inline-flex;
  border-radius: 4px;
  color: var(--text-h);
}

code {
  font-size: 15px;
  line-height: 135%;
  padding: 4px 8px;
  background: var(--code-bg);
}

```


# FILE: frontend\src\main.tsx

```plain
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

```


# FILE: frontend\tsconfig.app.json

```plain
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023", "DOM"],
    "module": "esnext",
    "types": ["vite/client"],
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}

```


# FILE: frontend\tsconfig.json

```plain
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}

```


# FILE: frontend\tsconfig.node.json

```plain
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "module": "esnext",
    "types": ["node"],
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,

    /* Linting */
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["vite.config.ts"]
}

```


# FILE: frontend\vite.config.ts

```plain
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/defi-money-match/',
  plugins: [react()],
})

```
