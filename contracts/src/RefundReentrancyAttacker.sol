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
