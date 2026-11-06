// Deploys XPad and writes web/config.json for the web app and server.
// Local:   npm run chain   (other window), then npm run deploy:local
// Testnet: put DEPLOYER_KEY=0x... in .env, fund it from a Robinhood Chain faucet, then npm run deploy:testnet
import { network } from "hardhat";
import { Wallet } from "ethers";
import { appendFileSync, writeFileSync } from "node:fs";

const { ethers, networkName } = await network.getOrCreate();

let key = process.env.VERIFIER_KEY;
if (!key) {
  key = Wallet.createRandom().privateKey;
  appendFileSync(".env", `\nVERIFIER_KEY=${key}\n`);
  console.log("Made a new verifier key and saved it to .env (keep it secret: it unlocks every creator's fees)");
}
const verifier = new Wallet(key);

const [deployer] = await ethers.getSigners();
if (!deployer) throw new Error("No deployer: set DEPLOYER_KEY in .env");
console.log(`Deploying from ${deployer.address} on ${networkName}`);
const pad = await ethers.deployContract("XPad", [verifier.address]);
await pad.waitForDeployment();
const receipt = await pad.deploymentTransaction().wait();
const { chainId } = await ethers.provider.getNetwork();

const testnet = networkName === "rhTestnet";
const config = {
  chainId: Number(chainId),
  chainName: testnet ? "Robinhood Chain Testnet" : "Local test chain",
  rpc: testnet ? process.env.RH_RPC_URL || "https://rpc.testnet.chain.robinhood.com" : "http://127.0.0.1:8545",
  explorer: testnet ? "https://explorer.testnet.chain.robinhood.com" : "",
  xpad: pad.target,
  deployBlock: receipt.blockNumber,
};
writeFileSync("web/config.json", JSON.stringify(config, null, 2));
console.log(`XPad at ${pad.target}, config written to web/config.json`);
