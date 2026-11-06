// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract XToken is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 supply) ERC20(name_, symbol_) {
        _mint(msg.sender, supply);
    }
}

/// Launches a coin for any X post, profile, community or space. Each coin trades on a
/// constant-product bonding curve against ETH; 1% of every trade is held for the X handle,
/// who claims it with a signature from the verifier (proof they posted their wallet on X).
contract XPad is ReentrancyGuard {
    uint256 public constant SUPPLY = 1_000_000_000e18;
    uint256 public constant CURVE_TOKENS = 800_000_000e18; // most the curve will ever sell
    uint256 public constant V_ETH = 2 ether; // virtual ETH reserve at launch
    uint256 public constant V_TOKENS = 1_073_000_000e18; // virtual token reserve at launch
    uint256 public constant FEE_BPS = 100; // 1% creator fee

    struct Curve {
        bytes32 handle; // keccak256 of the lowercase X handle that earns the fees
        uint256 vEth;
        uint256 vTokens;
        uint256 sold;
    }

    address public immutable verifier;
    mapping(address => Curve) public curves;
    mapping(bytes32 => uint256) public fees; // handle hash => unclaimed wei

    event Launched(address indexed token, address indexed launcher, string handle, string source, string name, string symbol);
    event Trade(address indexed token, address indexed trader, bool isBuy, uint256 eth, uint256 tokens, uint256 vEth, uint256 vTokens, uint256 time);
    event Claimed(bytes32 indexed handleHash, string handle, address to, uint256 amount);

    constructor(address verifier_) {
        require(verifier_ != address(0), "no verifier");
        verifier = verifier_;
    }

    function launch(string calldata name, string calldata symbol, string calldata handle, string calldata source)
        external
        returns (address token)
    {
        _checkHandle(handle);
        require(bytes(name).length > 0 && bytes(name).length <= 32, "bad name");
        require(bytes(symbol).length > 0 && bytes(symbol).length <= 10, "bad symbol");
        require(bytes(source).length <= 200, "bad source");
        token = address(new XToken(name, symbol, SUPPLY));
        curves[token] = Curve(keccak256(bytes(handle)), V_ETH, V_TOKENS, 0);
        emit Launched(token, msg.sender, handle, source, name, symbol);
    }

    function buy(address token, uint256 minTokens) external payable nonReentrant {
        Curve storage c = _curve(token);
        uint256 fee = msg.value * FEE_BPS / 10_000;
        uint256 ethIn = msg.value - fee;
        uint256 out = c.vTokens - _ceilDiv(c.vEth * c.vTokens, c.vEth + ethIn);
        require(out > 0 && out >= minTokens, "slippage");
        require(c.sold + out <= CURVE_TOKENS, "curve sold out, buy less");
        c.vEth += ethIn;
        c.vTokens -= out;
        c.sold += out;
        fees[c.handle] += fee;
        require(XToken(token).transfer(msg.sender, out));
        emit Trade(token, msg.sender, true, msg.value, out, c.vEth, c.vTokens, block.timestamp);
    }

    function sell(address token, uint256 amount, uint256 minEth) external nonReentrant {
        Curve storage c = _curve(token);
        require(amount > 0, "zero amount");
        require(XToken(token).transferFrom(msg.sender, address(this), amount));
        uint256 gross = c.vEth - _ceilDiv(c.vEth * c.vTokens, c.vTokens + amount);
        uint256 fee = gross * FEE_BPS / 10_000;
        uint256 out = gross - fee;
        require(out >= minEth, "slippage");
        c.vEth -= gross;
        c.vTokens += amount;
        c.sold -= amount;
        fees[c.handle] += fee;
        _send(msg.sender, out);
        emit Trade(token, msg.sender, false, out, amount, c.vEth, c.vTokens, block.timestamp);
    }

    /// Anyone may submit the verifier's signature; the money only ever goes to `to`.
    function claim(string calldata handle, address to, uint256 deadline, bytes calldata sig) external nonReentrant {
        require(block.timestamp <= deadline, "signature expired");
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(block.chainid, address(this), handle, to, deadline))
        );
        require(ECDSA.recover(digest, sig) == verifier, "bad signature");
        bytes32 h = keccak256(bytes(handle));
        uint256 amount = fees[h];
        require(amount > 0, "nothing to claim");
        fees[h] = 0;
        _send(to, amount);
        emit Claimed(h, handle, to, amount);
    }

    function feesOf(string calldata handle) external view returns (uint256) {
        return fees[keccak256(bytes(handle))];
    }

    function _curve(address token) private view returns (Curve storage c) {
        c = curves[token];
        require(c.vTokens != 0, "unknown token");
    }

    // X handles: 1-15 chars of a-z 0-9 _, lowercase so fees can't split across spellings.
    function _checkHandle(string calldata handle) private pure {
        bytes calldata b = bytes(handle);
        require(b.length > 0 && b.length <= 15, "bad handle");
        for (uint256 i; i < b.length; i++) {
            bytes1 ch = b[i];
            require((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch == "_", "bad handle");
        }
    }

    // Rounds the new reserve up so every trade rounds in the pool's favour.
    function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) {
        return (a + b - 1) / b;
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "ETH send failed");
    }
}
