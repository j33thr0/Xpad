# X pad

Launch a coin for any X post, profile, community or space on Robinhood Chain. Each coin trades on a bonding curve against ETH. 1% of every trade is held for the X handle, who claims it by posting their wallet address on X.

- `contracts/XPad.sol`: launchpad, curve and fee vault (one contract)
- `server.js`: serves the app and checks fee-claim posts (X's free oEmbed endpoint, no API key)
- `web/index.html`: the app (Launch, Explore, coin page, Claim fees)

## Run locally

```bash
npm install
npm test
npm run chain          # leave running
npm run deploy:local   # in a second window; makes VERIFIER_KEY in .env
npm start              # http://localhost:3000
```

With no wallet extension, the local chain lets the app use a built-in test account.

## Robinhood Chain testnet

1. Make a fresh MetaMask account for deploying and put its key in `.env` as `DEPLOYER_KEY=0x...`.
2. Get testnet ETH for it from a Robinhood Chain faucet.
3. `npm run deploy:testnet`, then `npm start`.

Chain ID 46630, RPC https://rpc.testnet.chain.robinhood.com, explorer https://explorer.testnet.chain.robinhood.com.

`.env` holds `VERIFIER_KEY`: whoever has it can pay out every creator's fees. Never commit or share it.

## Not built yet

- Graduation: when the curve sells out (800M coins), nothing moves liquidity to a DEX. The other 200M stay in the contract.
- Coin images and metadata beyond name and ticker (avatars come from unavatar.io).
- An indexer: the app reads every event from the chain on each page view, which is fine for hundreds of coins, not thousands.
- Rate limiting on `/api/verify`.
- A way for a creator to opt out of coins made from their posts.

Testnet only. Running this with real money from Belgium needs a lawyer first (MiCA licensing).
