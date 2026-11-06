import { AbiCoder, getBytes, keccak256 } from "ethers";

// Must match XPad.claim: keccak256(abi.encode(chainid, xpad, handle, to, deadline)), eth-signed.
export function signClaim(wallet, chainId, xpad, handle, to, deadline) {
  const hash = keccak256(
    AbiCoder.defaultAbiCoder().encode(["uint256", "address", "string", "address", "uint256"], [chainId, xpad, handle, to, deadline]),
  );
  return wallet.signMessage(getBytes(hash));
}
