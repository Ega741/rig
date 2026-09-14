// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {HashMine} from "./HashMine.sol";
import {IPonsFactory, IPonsCurve, IPonsMemeHook, IPonsFeeEscrow, PonsGraduationPhase} from "./interfaces/IPons.sol";

/// @title PonsTreasury
/// @notice Creator-fee recipient of a PONS V2 launch that forwards every wei it collects to HashMine, where
/// miners split it by work. It buys nothing, swaps nothing and has no function that pays ETH to the owner;
/// the fee stream can be handed to another contract only behind a 7-day timelock.
/// @dev Spec: docs/superpowers/specs/2026-09-14-hashmine-design.md, section 4.
contract PonsTreasury is Ownable2Step, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;

    uint256 public constant MIGRATION_DELAY = 7 days;
    uint256 public constant MIGRATION_WINDOW = 3 days;

    IPonsFactory public immutable factory;
    IPonsMemeHook public immutable memeHook;
    IPonsFeeEscrow public immutable feeEscrow;
    HashMine public immutable hashMine;

    address public token;
    address public curve;
    uint256 public lastHarvestAt;
    address public pendingRecipient;
    uint256 public migrationEta;

    event Adopted(address indexed token, address indexed curve);
    event Harvested(uint256 forwarded, PonsGraduationPhase phase);
    event MigrationProposed(address indexed newRecipient, uint256 eta);
    event MigrationCancelled(address indexed newRecipient);
    event MigrationExecuted(address indexed newRecipient);

    error ZeroAddress();
    error AlreadyAdopted();
    error NotAdopted();
    error NotFeeRecipient();
    error NotEthQuoted();
    error TransferFailed();
    error NoPendingMigration();
    error MigrationNotReady(uint256 eta);
    error MigrationExpired(uint256 deadline);

    constructor(address initialOwner, IPonsFactory factory_, HashMine hashMine_) Ownable(initialOwner) {
        if (address(factory_) == address(0) || address(hashMine_) == address(0)) revert ZeroAddress();
        factory = factory_;
        memeHook = IPonsMemeHook(factory_.memeHook());
        feeEscrow = IPonsFeeEscrow(factory_.feeEscrow());
        hashMine = hashMine_;
    }

    receive() external payable {}

    /// @notice Binds the treasury to the token launched on PONS, once its creator fees are routed here
    /// (`creatorFeeRecipient == this`, set at launch or via `transferCreatorFeeRecipient`). ETH-quoted launches only.
    function adopt(address token_) external onlyOwner {
        if (token != address(0)) revert AlreadyAdopted();
        IPonsFactory.LaunchedToken memory launched = factory.getLaunchedToken(token_);
        if (!launched.exists || launched.creatorFeeRecipient != address(this)) revert NotFeeRecipient();
        if (launched.pairToken != address(0)) revert NotEthQuoted();
        token = token_;
        curve = launched.curve;
        emit Adopted(token_, launched.curve);
    }

    /// @notice Pulls creator fees from PONS and forwards this contract's whole ETH balance to HashMine.
    /// Callable by anyone.
    function harvest() external nonReentrant returns (uint256 forwarded) {
        address token_ = token;
        if (token_ == address(0)) revert NotAdopted();
        lastHarvestAt = block.timestamp;

        IPonsFactory.LaunchedToken memory launched = factory.getLaunchedToken(token_);
        PonsGraduationPhase phase = launched.phase;
        if (phase == PonsGraduationPhase.NotGraduated) {
            try IPonsCurve(curve).sweepFees(0) {} catch {}
        } else if (phase == PonsGraduationPhase.PoolCreated) {
            try memeHook.sweepPoolFees(_poolId(launched), 0, 0) {} catch {}
        }
        try feeEscrow.claim() {} catch {}

        forwarded = address(this).balance;
        if (forwarded != 0) {
            (bool ok,) = address(hashMine).call{value: forwarded}("");
            if (!ok) revert TransferFailed();
        }
        emit Harvested(forwarded, phase);
    }

    /// @notice Starts the timelock for moving creator fees to `newRecipient`.
    function proposeMigration(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        pendingRecipient = newRecipient;
        migrationEta = block.timestamp + MIGRATION_DELAY;
        emit MigrationProposed(newRecipient, migrationEta);
    }

    function cancelMigration() external onlyOwner {
        address cancelled = pendingRecipient;
        if (cancelled == address(0)) revert NoPendingMigration();
        delete pendingRecipient;
        delete migrationEta;
        emit MigrationCancelled(cancelled);
    }

    /// @notice Moves PONS creator fees to the proposed recipient, inside [eta, eta + MIGRATION_WINDOW].
    function executeMigration() external onlyOwner {
        if (token == address(0)) revert NotAdopted();
        address newRecipient = pendingRecipient;
        if (newRecipient == address(0)) revert NoPendingMigration();
        uint256 eta = migrationEta;
        // Timelock window checks are the purpose of this function.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < eta) revert MigrationNotReady(eta);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > eta + MIGRATION_WINDOW) revert MigrationExpired(eta + MIGRATION_WINDOW);
        delete pendingRecipient;
        delete migrationEta;
        factory.transferCreatorFeeRecipient(token, newRecipient);
        emit MigrationExecuted(newRecipient);
    }

    function _poolId(IPonsFactory.LaunchedToken memory launched) private view returns (PoolId) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(launched.token),
            fee: launched.poolFee,
            tickSpacing: launched.tickSpacing,
            hooks: IHooks(address(memeHook))
        }).toId();
    }
}
