import { expect } from "chai";
import { network } from "hardhat";
import { signClaim } from "../sign.js";

const { ethers } = await network.create();
const E = ethers.parseEther;

async function setup() {
  const [launcher, alice, bob] = await ethers.getSigners();
  const verifier = ethers.Wallet.createRandom();
  const pad = await ethers.deployContract("XPad", [verifier.address]);
  const tx = await pad.launch("Builder", "BUILD", "builder", "https://x.com/builder");
  const ev = (await tx.wait()).logs.map((l) => pad.interface.parseLog(l)).find((l) => l?.name === "Launched");
  const token = await ethers.getContractAt("XToken", ev.args.token);
  return { pad, token, verifier, launcher, alice, bob };
}

describe("XPad", () => {
  it("buys on the curve and takes a 1% creator fee", async () => {
    const { pad, token, alice } = await setup();
    await pad.connect(alice).buy(token.target, 0, { value: E("1") });
    const got = await token.balanceOf(alice.address);
    // 0.99 ETH into 2 ETH virtual: tokens = 1.073B * 0.99 / 2.99
    expect(got).to.be.closeTo(E("1073000000") * 99n / 299n, E("1"));
    expect(await pad.feesOf("builder")).to.equal(E("0.01"));
  });

  it("round trip never pays out more than went in", async () => {
    const { pad, token, alice } = await setup();
    await pad.connect(alice).buy(token.target, 0, { value: E("2") });
    const bal = await token.balanceOf(alice.address);
    await token.connect(alice).approve(pad.target, bal);
    const before = await ethers.provider.getBalance(pad.target);
    await pad.connect(alice).sell(token.target, bal, 0);
    const left = await ethers.provider.getBalance(pad.target);
    expect(left).to.be.gte(await pad.feesOf("builder")); // contract stays solvent for fees
    expect(before - left).to.be.lt(E("2"));
    const c = await pad.curves(token.target);
    expect(c.sold).to.equal(0n);
    expect(c.vEth).to.be.gte(E("2"));
  });

  it("enforces slippage and the curve cap", async () => {
    const { pad, token, alice } = await setup();
    await expect(pad.connect(alice).buy(token.target, E("1000000000"), { value: E("0.1") })).to.be.revertedWith("slippage");
    await expect(pad.connect(alice).buy(token.target, 0, { value: E("100") })).to.be.revertedWith("curve sold out, buy less");
  });

  it("rejects bad handles", async () => {
    const { pad } = await setup();
    await expect(pad.launch("A", "A", "Builder", "")).to.be.revertedWith("bad handle");
    await expect(pad.launch("A", "A", "", "")).to.be.revertedWith("bad handle");
  });

  it("pays fees only with the verifier's signature, once", async () => {
    const { pad, token, verifier, alice, bob } = await setup();
    await pad.connect(alice).buy(token.target, 0, { value: E("1") });
    const { chainId } = await ethers.provider.getNetwork();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const fake = await signClaim(ethers.Wallet.createRandom(), chainId, pad.target, "builder", bob.address, deadline);
    await expect(pad.claim("builder", bob.address, deadline, fake)).to.be.revertedWith("bad signature");

    const sig = await signClaim(verifier, chainId, pad.target, "builder", bob.address, deadline);
    await expect(pad.claim("builder", alice.address, deadline, sig)).to.be.revertedWith("bad signature"); // can't redirect
    const before = await ethers.provider.getBalance(bob.address);
    await pad.connect(alice).claim("builder", bob.address, deadline, sig);
    expect((await ethers.provider.getBalance(bob.address)) - before).to.equal(E("0.01"));
    await expect(pad.claim("builder", bob.address, deadline, sig)).to.be.revertedWith("nothing to claim");
  });
});
