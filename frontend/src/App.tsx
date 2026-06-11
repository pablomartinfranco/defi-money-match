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
    if (!statusMatchId) return;
    
    const id = BigInt(statusMatchId);
    const data = await contract.getMatch(id);
    console.log("Loaded match raw:", data);

    setMatchData({
      challenger: data.challenger,
      opponent: data.opponent,
      stakeAmount: data.stakeAmount,
      activationTimestamp: data.activationTimestamp,
      challengerRefunded: data.challengerRefunded,
      opponentRefunded: data.opponentRefunded,
      state: Number(data.state),
    });
    console.log("Parsed match state:", Number(data.state));

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
            {/* <p>State: {MATCH_STATE_LABELS[matchData.state]}</p> */}
            <p>State: {MATCH_STATE_LABELS[matchData.state] ?? `Unknown (${matchData.state})`}</p>
            <p>Stake: {ethers.formatEther(matchData.stakeAmount)} ETH</p>
            <p>Replay URL (from logs): {replayUrl ?? "Not found"}</p>
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
