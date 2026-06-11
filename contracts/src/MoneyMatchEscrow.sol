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

    function createMatch(uint256 stakeAmount, string calldata replayUrl) external payable returns (uint256 matchId) {
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
        emit ReplayRegistered(matchId, replayUrl);
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

    function confirmDefeat(uint256 matchId, address winner) external nonReentrant {
        Match storage matchInfo = _getMatch(matchId);

        if (matchInfo.state != MatchState.Active) revert InvalidState(matchInfo.state);
        if (!_isParticipant(matchInfo, msg.sender)) revert Unauthorized();
        if (!_isParticipant(matchInfo, winner) || winner == msg.sender) revert InvalidWinner();

        matchInfo.state = MatchState.Resolved;

        uint256 payout = matchInfo.stakeAmount * 2;
        (bool success,) = payable(winner).call{value: payout}("");
        if (!success) revert TransferFailed();

        emit DefeatConfirmed(matchId, msg.sender, winner);
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
