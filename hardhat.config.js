import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig } from "hardhat/config";

try { process.loadEnvFile(); } catch {} // .env is optional (only needed for testnet)

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: { version: "0.8.34", settings: { evmVersion: "cancun", optimizer: { enabled: true, runs: 200 } } }, // Arbitrum Orbit chains lag the newest EVM
  networks: {
    localhost: { type: "http", url: "http://127.0.0.1:8545" },
    rhTestnet: {
      type: "http",
      chainType: "generic",
      url: process.env.RH_RPC_URL || "https://rpc.testnet.chain.robinhood.com",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
});
