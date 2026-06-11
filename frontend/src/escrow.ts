export const ESCROW_ABI = [
  "function createMatch(uint256 stakeAmount, string replayUrl) payable returns (uint256)",
  "function joinMatch(uint256 matchId) payable",
  "function confirmDefeat(uint256 matchId, address winner)",
  "function enableRefund(uint256 matchId)",
  "function claimRefund(uint256 matchId)",
  "function getMatch(uint256 matchId) view returns (tuple(address challenger, address opponent, uint256 stakeAmount, uint256 activationTimestamp, bool challengerRefunded, bool opponentRefunded, uint8 state))",
  "event ReplayRegistered(uint256 indexed matchId, string replayUrl)",
] as const;

export const MATCH_STATE_LABELS: Record<number, string> = {
  0: "Waiting for opponent",
  1: "Active",
  2: "Resolved",
  3: "Refund available",
};

export const REFUND_DELAY_SECONDS = 48 * 60 * 60;
