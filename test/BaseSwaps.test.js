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

const Swaps = artifacts.require("BaseSwaps");
const Token = artifacts.require("TestToken");

contract("BaseSwaps", ([owner, ...accounts]) => {
  let now;

  beforeEach(async () => {
    now = await time.latest();
  });

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
      await token.mint(from, value);
      await token.approve(swaps.address, value, { from });
      const { logs } = await swaps.depositTokens(token.address, { from });
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
    await shouldFail(swaps.depositTokens(token.address, { from }));
  });
});
