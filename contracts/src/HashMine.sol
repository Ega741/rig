// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title HashMine
/// @notice Keccak proof-of-work share pool. Miners submit shares for the current round; when a
/// round closes it releases a fixed fraction of the token balance, split in proportion to work.
/// @dev Spec: docs/superpowers/specs/2026-09-14-hashmine-design.md, section 5.
contract HashMine {
    using SafeERC20 for IERC20;

    struct Params {
        uint256 roundLength;
        uint256 releaseBps;
        uint256 targetShares;
        uint8 minDifficulty;
    }

    struct Round {
        bytes32 challenge;
        bytes32 seed;
        uint192 work;
        uint8 minDifficulty;
        bool closed;
        uint256 rewardPerWork;
    }

    struct Miner {
        uint64 round;
        uint192 work;
        uint256 lastNonce;
        uint256 claimable;
    }

    uint8 public constant MAX_DIFFICULTY = 96;
    uint256 public constant MAX_NONCES = 64;
    uint256 private constant BPS = 10_000;
    uint256 private constant PRECISION = 1e36;

    IERC20 public immutable token;
    uint256 public immutable genesis;
    uint256 public immutable roundLength;
    uint256 public immutable releaseBps;
    uint256 public immutable targetShares;
    uint8 public immutable minDifficultyFloor;
    bytes32 public immutable genesisChallenge;

    /// @notice Latest round with at least one accepted share; 0 before the first share.
    uint256 public lastActiveRound;
    /// @notice Tokens released to closed rounds and not yet claimed.
    uint256 public reserved;

    mapping(uint256 round => Round) private _rounds;
    mapping(address beneficiary => Miner) private _miners;

    event ShareBatch(
        address indexed beneficiary,
        uint256 indexed round,
        uint8 difficulty,
        uint256 count,
        uint256 work,
        bytes32 lastHash
    );
    event RoundClosed(uint256 indexed round, uint256 work, uint256 release);
    event Claimed(address indexed beneficiary, uint256 amount);

    error ZeroAddress();
    error InvalidParams();
    error WrongRound(uint256 submitted, uint256 current);
    error BadNonceCount(uint256 count);
    error BadDifficulty(uint8 difficulty, uint8 minimum);
    error NonceNotIncreasing(uint256 index);
    error InvalidShare(uint256 index);

    constructor(IERC20 token_, Params memory params) {
        if (address(token_) == address(0)) revert ZeroAddress();
        if (
            params.roundLength == 0 || params.releaseBps == 0 || params.releaseBps > BPS || params.targetShares == 0
                || params.minDifficulty == 0 || params.minDifficulty > MAX_DIFFICULTY
        ) revert InvalidParams();

        token = token_;
        genesis = block.timestamp;
        roundLength = params.roundLength;
        releaseBps = params.releaseBps;
        targetShares = params.targetShares;
        minDifficultyFloor = params.minDifficulty;
        genesisChallenge = keccak256(abi.encode(address(this), block.chainid, block.timestamp));
    }

    // -------------------------------------------------------------- mutations

    /// @notice Submits `nonces` as shares of `difficulty` for `beneficiary` in the current round.
    /// @dev Anyone may send; work is credited to the beneficiary bound inside every hash.
    function submit(address beneficiary, uint256 round, uint8 difficulty, uint256[] calldata nonces) external {
        if (beneficiary == address(0)) revert ZeroAddress();
        uint256 current = currentRound();
        if (round != current) revert WrongRound(round, current);
        if (nonces.length == 0 || nonces.length > MAX_NONCES) revert BadNonceCount(nonces.length);
        uint8 minimum = minDifficulty(current);
        if (difficulty < minimum || difficulty > MAX_DIFFICULTY) revert BadDifficulty(difficulty, minimum);

        bytes32 roundChallenge = challenge(current);
        Miner storage miner = _miners[beneficiary];
        bool sameRound = miner.round == current;
        (uint256 lastNonce, bytes32 lastHash) =
            _verifyShares(beneficiary, roundChallenge, difficulty, nonces, sameRound, miner.lastNonce);

        if (lastActiveRound != current) _activate(current, roundChallenge, minimum);
        _record(beneficiary, miner, current, sameRound, difficulty, nonces.length, lastNonce, lastHash);
    }

    /// @notice Pays `beneficiary` everything settled so far. Work in a still-running round is not paid.
    function claim(address beneficiary) external returns (uint256 amount) {
        Miner storage miner = _miners[beneficiary];
        if (miner.work != 0 && miner.round < currentRound()) _settle(miner);
        amount = miner.claimable;
        if (amount == 0) return 0;
        miner.claimable = 0;
        reserved -= amount;
        token.safeTransfer(beneficiary, amount);
        emit Claimed(beneficiary, amount);
    }

    // ------------------------------------------------------------------ views

    function currentRound() public view returns (uint256) {
        return (block.timestamp - genesis) / roundLength + 1;
    }

    function roundStart(uint256 round) external view returns (uint256) {
        return genesis + (round - 1) * roundLength;
    }

    /// @notice Tokens not yet released to any round.
    function rewardPool() public view returns (uint256) {
        return token.balanceOf(address(this)) - reserved;
    }

    /// @notice Claimable amount plus the beneficiary's share of its last round; for a round that is
    /// not closed yet this is an estimate against the current pool.
    function pending(address beneficiary) external view returns (uint256 amount) {
        Miner memory miner = _miners[beneficiary];
        amount = miner.claimable;
        if (miner.work == 0) return amount;
        Round memory info = _rounds[miner.round];
        if (info.closed) return amount + Math.mulDiv(miner.work, info.rewardPerWork, PRECISION);
        uint256 release = rewardPool() * releaseBps / BPS;
        return amount + Math.mulDiv(release, miner.work, info.work);
    }

    /// @notice Challenge of `round`. Stored for active rounds; derived from the last active round
    /// (the anchor) for rounds after it; zero for past rounds that never became active.
    function challenge(uint256 round) public view returns (bytes32) {
        uint256 anchor = lastActiveRound;
        if (round <= anchor) return _rounds[round].challenge;
        bytes32 anchorChallenge = anchor == 0 ? genesisChallenge : _rounds[anchor].challenge;
        return keccak256(abi.encode(anchorChallenge, _rounds[anchor].seed, round));
    }

    /// @notice Minimum share difficulty of `round`: enough bits for about `targetShares` shares
    /// given the anchor's work, minus one bit per empty round in between, clamped to the floor.
    function minDifficulty(uint256 round) public view returns (uint8) {
        uint256 anchor = lastActiveRound;
        if (round <= anchor) return _rounds[round].minDifficulty;
        uint256 bits = _bits(_rounds[anchor].work);
        uint256 gap = round - 1 - anchor;
        uint256 difficulty = bits > gap ? bits - gap : 0;
        if (difficulty < minDifficultyFloor) difficulty = minDifficultyFloor;
        if (difficulty > MAX_DIFFICULTY) difficulty = MAX_DIFFICULTY;
        // casting to 'uint8' is safe because difficulty is clamped to MAX_DIFFICULTY (96) above
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint8(difficulty);
    }

    function roundInfo(uint256 round) external view returns (Round memory) {
        return _rounds[round];
    }

    function roundWork(uint256 round) external view returns (uint256) {
        return _rounds[round].work;
    }

    function minerState(address beneficiary) external view returns (Miner memory) {
        return _miners[beneficiary];
    }

    // ---------------------------------------------------------------- private

    function _bits(uint256 work) private view returns (uint256) {
        if (work <= targetShares) return 0;
        return Math.log2(Math.ceilDiv(work, targetShares), Math.Rounding.Ceil);
    }

    /// @dev Checks ordering and difficulty of every share; returns the last nonce and hash.
    function _verifyShares(
        address beneficiary,
        bytes32 roundChallenge,
        uint8 difficulty,
        uint256[] calldata nonces,
        bool hasPrevious,
        uint256 previousNonce
    ) private pure returns (uint256 previous, bytes32 shareHash) {
        uint256 shift = 256 - uint256(difficulty);
        previous = previousNonce;
        for (uint256 i; i < nonces.length; ++i) {
            uint256 nonce = nonces[i];
            if ((i != 0 || hasPrevious) && nonce <= previous) revert NonceNotIncreasing(i);
            shareHash = keccak256(abi.encodePacked(beneficiary, roundChallenge, nonce));
            if (uint256(shareHash) >> shift != 0) revert InvalidShare(i);
            previous = nonce;
        }
    }

    function _record(
        address beneficiary,
        Miner storage miner,
        uint256 round,
        bool sameRound,
        uint8 difficulty,
        uint256 count,
        uint256 lastNonce,
        bytes32 lastHash
    ) private {
        uint192 work = SafeCast.toUint192(count << difficulty);
        if (!sameRound) {
            _settle(miner);
            // casting to 'uint64' is safe because round counts roundLength periods since genesis
            // forge-lint: disable-next-line(unsafe-typecast)
            miner.round = uint64(round);
        }
        miner.lastNonce = lastNonce;
        miner.work += work;

        Round storage info = _rounds[round];
        info.work += work;
        info.seed = lastHash;

        emit ShareBatch(beneficiary, round, difficulty, count, work, lastHash);
    }

    function _activate(uint256 round, bytes32 roundChallenge, uint8 minimum) private {
        uint256 previous = lastActiveRound;
        if (previous != 0 && !_rounds[previous].closed) _close(previous);
        Round storage info = _rounds[round];
        info.challenge = roundChallenge;
        info.minDifficulty = minimum;
        lastActiveRound = round;
    }

    /// @dev Only the last active round can be open, and only after it has ended.
    function _close(uint256 round) private {
        Round storage info = _rounds[round];
        uint256 release = rewardPool() * releaseBps / BPS;
        info.rewardPerWork = Math.mulDiv(release, PRECISION, info.work);
        info.closed = true;
        reserved += release;
        emit RoundClosed(round, info.work, release);
    }

    /// @dev Caller guarantees `miner.round` has ended.
    function _settle(Miner storage miner) private {
        uint256 work = miner.work;
        if (work == 0) return;
        Round storage info = _rounds[miner.round];
        if (!info.closed) _close(miner.round);
        miner.claimable += Math.mulDiv(work, info.rewardPerWork, PRECISION);
        miner.work = 0;
    }
}
