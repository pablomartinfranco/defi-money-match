import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("MoneyMatchEscrow", function () {
  async function deployFixture() {
    const [challenger, opponent, outsider, attackerOwner] = await hre.ethers.getSigners();

    const escrowFactory = await hre.ethers.getContractFactory("MoneyMatchEscrow");
    const escrow = await escrowFactory.deploy();

    const attackerFactory = await hre.ethers.getContractFactory("RefundReentrancyAttacker");
    const attacker = await attackerFactory.connect(attackerOwner).deploy(await escrow.getAddress());

    return { escrow, attacker, challenger, opponent, outsider, attackerOwner };
  }

  it("runs happy path: create, join, loser confirms, winner paid", async function () {
    const { escrow, challenger, opponent } = await loadFixture(deployFixture);
    const stake = hre.ethers.parseEther("1");

    await expect(
      escrow.connect(challenger).createMatch(stake, "https://replays.example/match-1", { value: stake })
    )
      .to.emit(escrow, "MatchCreated")
      .withArgs(0, challenger.address, stake);

    await expect(escrow.connect(opponent).joinMatch(0, { value: stake }))
      .to.emit(escrow, "MatchJoined")
      .withArgs(0, opponent.address);

    await expect(() => escrow.connect(challenger).confirmDefeat(0, opponent.address)).to.changeEtherBalances(
      [challenger, opponent],
      [0n, stake * 2n]
    );

    const matchInfo = await escrow.getMatch(0);
    expect(matchInfo.state).to.equal(2n);
  });

  it("enables refunds after timelock and each player gets own deposit", async function () {
    const { escrow, challenger, opponent } = await loadFixture(deployFixture);
    const stake = hre.ethers.parseEther("0.5");

    await escrow.connect(challenger).createMatch(stake, "https://replays.example/match-2", { value: stake });
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

    await escrow.connect(challenger).createMatch(stake, "https://replays.example/match-3", { value: stake });
    await escrow.connect(opponent).joinMatch(0, { value: stake });

    await expect(escrow.connect(outsider).confirmDefeat(0, challenger.address)).to.be.revertedWithCustomError(
      escrow,
      "Unauthorized"
    );

    await expect(escrow.connect(challenger).confirmDefeat(0, challenger.address)).to.be.revertedWithCustomError(
      escrow,
      "InvalidWinner"
    );

    await escrow.connect(challenger).confirmDefeat(0, opponent.address);

    await expect(escrow.connect(opponent).confirmDefeat(0, challenger.address)).to.be.revertedWithCustomError(
      escrow,
      "InvalidState"
    );
  });

  it("prevents double refund claims", async function () {
    const { escrow, challenger, opponent } = await loadFixture(deployFixture);
    const stake = hre.ethers.parseEther("0.2");

    await escrow.connect(challenger).createMatch(stake, "https://replays.example/match-4", { value: stake });
    await escrow.connect(opponent).joinMatch(0, { value: stake });

    await time.increase(48 * 60 * 60 + 1);
    await escrow.connect(opponent).enableRefund(0);

    await escrow.connect(challenger).claimRefund(0);

    await expect(escrow.connect(challenger).claimRefund(0)).to.be.revertedWithCustomError(escrow, "AlreadyRefunded");
  });

  it("blocks a reentrancy attempt during refund", async function () {
    const { escrow, attacker, challenger, attackerOwner } = await loadFixture(deployFixture);
    const stake = hre.ethers.parseEther("0.4");

    await escrow.connect(challenger).createMatch(stake, "https://replays.example/match-5", { value: stake });
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
