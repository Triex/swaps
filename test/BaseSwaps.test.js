const {
  balance,
  BN,
  constants: { ZERO_ADDRESS },
  ether,
  expectEvent,
  shouldFail,
  time,
  time: { duration }
} = require("openzeppelin-test-helpers");

const { expect } = require("chai");

const Swaps = artifacts.require("BaseSwaps");
const Token = artifacts.require("TestToken");

contract("BaseSwaps", ([owner, ...accounts]) => {
  let now;
  let gasPrice = new BN("20000000000");

  beforeEach(async () => {
    now = await time.latest();
  });

  async function deposit(investor, amount, token, swaps) {
    await token.mint(investor, amount);
    await token.approve(swaps.address, amount, { from: investor });
    const depositFunc = (token.address === await swaps.baseAddress())
      ? swaps.depositBase
      : swaps.depositQuote;
    return depositFunc({ from: investor });
  }

  it("should fail with same addresses", async () => {
    await shouldFail(Swaps.new(
      owner,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      1000,
      1500,
      now.add(duration.minutes(1))
    ));

    await shouldFail(Swaps.new(
      owner,
      accounts[0],
      accounts[0],
      1000,
      1500,
      now.add(duration.minutes(1))
    ));
  });

  it("should fail expiration date in past", async () => {
    await shouldFail(Swaps.new(
      owner,
      accounts[0],
      accounts[1],
      1000,
      1500,
      now.sub(duration.minutes(1))
    ));
  });

  it("should properly deployed", async () => {
    await Swaps.new(
      owner,
      accounts[0],
      accounts[1],
      1000,
      1500,
      now.add(duration.minutes(1))
    );
  });

  it("can deposit eth several times", async () => {
    const ethLimit = ether("1");
    const tokenLimit = ether("2");
    const token = await Token.new();
    const swaps = await Swaps.new(
      owner,
      ZERO_ADDRESS,
      token.address,
      ethLimit,
      tokenLimit,
      now.add(duration.minutes(1))
    );

    const from = accounts[0];
    const value = ethLimit.div(new BN("4"));
    let expectedBalance = new BN("0");
    for (let i = 0; i < 3; i++) {
      const { logs } = await swaps.sendTransaction({ from, value });
      expectedBalance = expectedBalance.add(value);
      expectEvent.inLogs(logs, "Deposit", {
        token: ZERO_ADDRESS,
        user: from,
        amount: value,
        balance: expectedBalance
      });
    }
  });

  it("can deposit tokens several times", async () => {
    const ethLimit = ether("1");
    const tokenLimit = ether("2");
    const token = await Token.new();
    const swaps = await Swaps.new(
      owner,
      ZERO_ADDRESS,
      token.address,
      ethLimit,
      tokenLimit,
      now.add(duration.minutes(1))
    );

    const from = accounts[0];
    const value = tokenLimit.div(new BN("4"));
    let expectedBalance = new BN("0");
    for (let i = 0; i < 3; i++) {
      const { logs } = await deposit(from, value, token, swaps);
      expectedBalance = expectedBalance.add(value);
      expectEvent.inLogs(logs, "Deposit", {
        token: token.address,
        user: from,
        amount: value,
        balance: expectedBalance
      });
    }
  });

  it("cannot deposit without approve", async () => {
    const ethLimit = ether("1");
    const tokenLimit = ether("2");
    const token = await Token.new();
    const swaps = await Swaps.new(
      owner,
      ZERO_ADDRESS,
      token.address,
      ethLimit,
      tokenLimit,
      now.add(duration.minutes(1))
    );

    const from = accounts[0];
    await shouldFail(swaps.depositQuote(token.address, { from }));
  });

  it("successful swap", async () => {
    const ethLimit = ether("1");
    const tokenLimit = ether("2");
    const token = await Token.new();
    const swaps = await Swaps.new(
      owner,
      ZERO_ADDRESS,
      token.address,
      ethLimit,
      tokenLimit,
      now.add(duration.minutes(1))
    );

    await swaps.sendTransaction({ value: ethLimit, from: accounts[0] });

    await token.mint(accounts[1], tokenLimit);
    await token.approve(swaps.address, tokenLimit, { from: accounts[1] });
    const balanceTracker = await balance.tracker(accounts[1]);
    const { receipt: { gasUsed }, logs } = await swaps.depositQuote({ from: accounts[1] });

    expectEvent.inLogs(logs, "Swap", { byUser: accounts[1] });

    expect(await token.balanceOf(accounts[0])).to.be.bignumber.equal(tokenLimit);
    expect(await token.balanceOf(accounts[1])).to.be.bignumber.equal(new BN("0"));

    expect(await balanceTracker.delta()).to.be.bignumber.equal(ethLimit.sub(new BN(gasUsed).mul(gasPrice)));
  });

  it("swap between tokens", async () => {
    const tokens = [await Token.new(), await Token.new()];
    const limits = [ether("1"), ether("2")];

    const swaps = await Swaps.new(
      owner,
      tokens[0].address,
      tokens[1].address,
      limits[0],
      limits[1],
      now.add(duration.minutes(1))
    );

    for (let i = 0; i < tokens.length; i++) {
      await deposit(accounts[i], limits[i], tokens[i], swaps);
    }

    expect(await tokens[0].balanceOf(accounts[0])).to.be.bignumber.equal(new BN("0"));
    expect(await tokens[0].balanceOf(accounts[1])).to.be.bignumber.equal(limits[0]);
    expect(await tokens[1].balanceOf(accounts[1])).to.be.bignumber.equal(new BN("0"));
    expect(await tokens[1].balanceOf(accounts[0])).to.be.bignumber.equal(limits[1]);
  });

  it("swap between many addresses", async () => {
    const baseInvestors = accounts.slice(0, accounts.length / 2);
    const quoteInvestors = accounts.slice(accounts.length / 2, accounts.length);

    const baseToken = await Token.new();
    const quoteToken = await Token.new();

    const baseLimit = ether("1");
    const quoteLimit = ether("2");

    const swaps = await Swaps.new(
      owner,
      baseToken.address,
      quoteToken.address,
      baseLimit,
      quoteLimit,
      now.add(duration.minutes(1))
    );

    const baseAmount = baseLimit.div(new BN(baseInvestors.length));
    for (let i = 0; i < baseInvestors.length; i++) {
      await deposit(baseInvestors[i], baseAmount, baseToken, swaps);
    }

    const quoteAmount = quoteLimit.div(new BN(quoteInvestors.length));
    for (let i = 0; i < quoteInvestors.length; i++) {
      await deposit(quoteInvestors[i], quoteAmount, quoteToken, swaps);
    }

    expect(await swaps.isSwapped()).to.be.equal(true);
    expect(await swaps.baseInvestors()).to.be.eql(baseInvestors);
    expect(await swaps.quoteInvestors()).to.be.eql(quoteInvestors);

    const quoteAmountForBase = baseAmount.div(baseLimit).mul(quoteAmount);
    for (let i = 0; i < baseInvestors.length; i++) {
      expect(await baseToken.balanceOf(baseInvestors[i])).to.be.bignumber.equal(quoteAmountForBase);
    }

    const baseAmountForQuote = quoteAmount.div(quoteLimit).mul(baseAmount);
    for (let i = 0; i < quoteInvestors.length; i++) {
      expect(await quoteToken.balanceOf(quoteInvestors[i])).to.be.bignumber.equal(baseAmountForQuote);
    }
  });

  it("deposit from one address to both sides", async () => {
    const baseToken = await Token.new();
    const quoteToken = await Token.new();

    const baseLimit = ether("1");
    const quoteLimit = ether("2");

    const swaps = await Swaps.new(
      owner,
      baseToken.address,
      quoteToken.address,
      baseLimit,
      quoteLimit,
      now.add(duration.minutes(1))
    );

    await deposit(accounts[0], baseLimit, baseToken, swaps);
    await deposit(accounts[0], quoteLimit, quoteToken, swaps);

    expect(await swaps.isSwapped()).to.be.equal(true);
    expect(await baseToken.balanceOf(accounts[0])).to.be.bignumber.equal(baseLimit);
    expect(await quoteToken.balanceOf(accounts[0])).to.be.bignumber.equal(quoteLimit);
  });

  it("try to refund before filled one side", async () => {
    const baseToken = await Token.new();
    const quoteToken = await Token.new();

    const baseLimit = ether("1");
    const quoteLimit = ether("2");

    const swaps = await Swaps.new(
      owner,
      baseToken.address,
      quoteToken.address,
      baseLimit,
      quoteLimit,
      now.add(duration.minutes(1))
    );

    await deposit(accounts[0], baseLimit, baseToken, swaps);
    await swaps.refundBase({ from: accounts[0] });

    expect(await baseToken.balanceOf(accounts[0])).to.be.bignumber.equal(baseLimit);
    expect(await swaps.quoteRaised()).to.be.bignumber.equal(new BN("0"));
    expect(await swaps.baseUserInvestment(accounts[0])).to.be.bignumber.equal(new BN("0"));
    expect(await swaps.baseInvestors()).to.have.length(0);
  });

  it("try to refund after swap", async () => {
    const baseToken = await Token.new();
    const quoteToken = await Token.new();

    const baseLimit = ether("1");
    const quoteLimit = ether("2");

    const swaps = await Swaps.new(
      owner,
      baseToken.address,
      quoteToken.address,
      baseLimit,
      quoteLimit,
      now.add(duration.minutes(1))
    );

    await deposit(accounts[0], baseLimit, baseToken, swaps);
    await deposit(accounts[1], quoteLimit, quoteToken, swaps);

    await shouldFail(swaps.refundBase({ from: accounts[0] }));
    await shouldFail(swaps.refundQuote({ from: accounts[1] }));
  });

  it("cancel before end", async () => {
    const baseToken = await Token.new();
    const quoteToken = await Token.new();

    const baseLimit = ether("1");
    const quoteLimit = ether("2");

    const swaps = await Swaps.new(
      owner,
      baseToken.address,
      quoteToken.address,
      baseLimit,
      quoteLimit,
      now.add(duration.minutes(1))
    );

    await deposit(accounts[0], baseLimit, baseToken, swaps);

    await shouldFail(swaps.cancel({ from: accounts[0] }));

    const { logs } = await swaps.cancel();
    expectEvent.inLogs(logs, "Cancel");
    expect(await swaps.isCancelled()).to.be.equal(true);
    expect(await baseToken.balanceOf(accounts[0])).to.be.bignumber.equal(baseLimit);

    await shouldFail(deposit(accounts[1], quoteLimit, quoteToken, swaps));
  });

  it("after end", async () => {
    const baseToken = await Token.new();
    const quoteToken = await Token.new();

    const baseLimit = ether("1");
    const quoteLimit = ether("2");

    const swaps = await Swaps.new(
      owner,
      baseToken.address,
      quoteToken.address,
      baseLimit,
      quoteLimit,
      now.add(duration.minutes(1))
    );

    await deposit(accounts[0], baseLimit.div(new BN("2")), baseToken, swaps);

    await shouldFail(swaps.cancel({ from: accounts[0] }));

    await time.increaseTo((await swaps.expirationTimestamp()).add(duration.minutes(1)));

    await shouldFail(deposit(accounts[0], baseLimit.div(new BN("2")), baseToken, swaps));

    const { logs } = await swaps.cancel({ from: accounts[0] });
    expectEvent.inLogs(logs, "Cancel");
    expect(await swaps.isCancelled()).to.be.equal(true);
    expect(await baseToken.balanceOf(accounts[0])).to.be.bignumber.equal(baseLimit);
  });

  it("check deposit over limit for tokens", async () => {
    const baseToken = await Token.new();
    const quoteToken = await Token.new();

    const baseLimit = ether("1");
    const quoteLimit = ether("2");

    const swaps = await Swaps.new(
      owner,
      baseToken.address,
      quoteToken.address,
      baseLimit,
      quoteLimit,
      now.add(duration.minutes(1))
    );

    await deposit(accounts[0], baseLimit.div(new BN('2')), baseToken, swaps);
    await deposit(accounts[0], baseLimit, baseToken, swaps);
    await shouldFail(deposit(accounts[0], baseLimit, baseToken, swaps));
    expect(await baseToken.balanceOf(swaps.address)).to.be.bignumber.equal(baseLimit);
    expect(await swaps.baseRaised()).to.be.bignumber.equal(baseLimit);
    expect(await swaps.baseUserInvestment(accounts[0])).to.be.bignumber.equal(baseLimit);
  });

  it("check deposit over limit for ethers", async () => {
    const quoteToken = await Token.new();

    const baseLimit = ether("1");
    const quoteLimit = ether("2");

    const swaps = await Swaps.new(
      owner,
      ZERO_ADDRESS,
      quoteToken.address,
      baseLimit,
      quoteLimit,
      now.add(duration.minutes(1))
    );

    await swaps.depositBase({ from: accounts[0], value: baseLimit.div(new BN('2')) });
    await swaps.depositBase({ from: accounts[0], value: baseLimit });
    await shouldFail(swaps.depositBase({ from: accounts[0], value: baseLimit }));
    expect(await balance.current(swaps.address)).to.be.bignumber.equal(baseLimit);
    expect(await swaps.baseRaised()).to.be.bignumber.equal(baseLimit);
    expect(await swaps.baseUserInvestment(accounts[0])).to.be.bignumber.equal(baseLimit);
  });

  // todo: calculate investors count limit
});
