// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {HashMine} from "./HashMine.sol";
import {IPonsFactory, IPonsCurve, IPonsMemeHook, IPonsFeeEscrow, PonsGraduationPhase} from "./interfaces/IPons.sol";

/// @title PonsTreasury
/// @notice Launches the token on PONS V2 as its own creator-fee recipient, turns every creator fee into a
/// buyback of the token for HashMine, and can hand the fee stream to a new contract only behind a 7-day
/// timelock. It has no function that pays ETH or tokens to the owner.
/// @dev Spec: docs/superpowers/specs/2026-09-14-hashmine-design.md, section 4.
contract PonsTreasury is Ownable2Step, ReentrancyGuard, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    struct LaunchInput {
        string name;
        string symbol;
        string logo;
        string description;
        IPonsFactory.Socials socials;
        bytes32 expectedEconomics;
        bytes32 salt;
    }

    uint16 public constant CREATOR_TAX_BPS = 200;
    uint256 public constant LAUNCH_CONFIG_ID = 0;
    uint256 public constant HARVEST_INTERVAL = 12;
    uint256 public constant MIN_HARVEST = 0.001 ether;
    /// @dev sqrt(1.01) - 1 in parts per million, rounded down: a curve buy whose net input is at most
    /// this share of the quote reserve moves the curve price by at most 1%.
    uint256 public constant CURVE_MAX_NET_PPM = 4_987;
    uint256 public constant CURVE_MIN_OUT_BPS = 9_950;
    /// @dev sqrt(0.99) in parts per million, rounded up: one harvest lowers the pool price by at most 1%.
    uint256 public constant POOL_SQRT_PRICE_FLOOR_PPM = 994_988;
    uint256 public constant MIGRATION_DELAY = 7 days;
    uint256 public constant MIGRATION_WINDOW = 3 days;

    uint256 public constant ROUND_LENGTH = 600;
    uint256 public constant RELEASE_BPS = 48;
    uint256 public constant TARGET_SHARES = 4096;
    uint8 public constant MIN_DIFFICULTY = 20;

    IPonsFactory public immutable factory;
    IPoolManager public immutable poolManager;
    IPonsMemeHook public immutable memeHook;
    IPonsFeeEscrow public immutable feeEscrow;

    address public token;
    address public curve;
    HashMine public hashMine;
    uint256 public lastHarvestAt;
    address public pendingRecipient;
    uint256 public migrationEta;

    event Launched(address indexed token, address indexed curve, address hashMine);
    event Harvested(uint256 ethAvailable, uint256 ethSpent, uint256 tokensOut, PonsGraduationPhase phase);
    event MigrationProposed(address indexed newRecipient, uint256 eta);
    event MigrationCancelled(address indexed newRecipient);
    event MigrationExecuted(address indexed newRecipient);

    error ZeroAddress();
    error AlreadyLaunched();
    error HarvestTooSoon(uint256 nextAt);
    error NotPoolManager();
    error NoPendingMigration();
    error MigrationNotReady(uint256 eta);
    error MigrationExpired(uint256 deadline);

    constructor(address initialOwner, IPonsFactory factory_) Ownable(initialOwner) {
        if (address(factory_) == address(0)) revert ZeroAddress();
        factory = factory_;
        poolManager = IPoolManager(factory_.poolManager());
        memeHook = IPonsMemeHook(factory_.memeHook());
        feeEscrow = IPonsFeeEscrow(factory_.feeEscrow());
    }

    receive() external payable {}

    /// @notice Launches the token with this contract as creator-fee recipient and deploys HashMine.
    /// @dev `msg.value` must equal `factory.launchFee()`; the factory enforces it.
    function launch(LaunchInput calldata input) external payable onlyOwner returns (address token_, address curve_) {
        if (token != address(0)) revert AlreadyLaunched();
        IPonsFactory.TokenParams memory params = IPonsFactory.TokenParams({
            name: input.name,
            symbol: input.symbol,
            logo: input.logo,
            description: input.description,
            socials: input.socials,
            creatorFeeRecipient: address(this),
            creatorTaxBps: CREATOR_TAX_BPS,
            buybackEnabled: false,
            expectedEconomics: input.expectedEconomics,
            salt: input.salt
        });
        (token_, curve_) = factory.launchToken{value: msg.value}(params, LAUNCH_CONFIG_ID, address(0));
        token = token_;
        curve = curve_;
        hashMine = new HashMine(
            IERC20(token_),
            HashMine.Params({
                roundLength: ROUND_LENGTH,
                releaseBps: RELEASE_BPS,
                targetShares: TARGET_SHARES,
                minDifficulty: MIN_DIFFICULTY
            })
        );
        emit Launched(token_, curve_, address(hashMine));
    }
    /// @notice Pulls creator fees from PONS and spends them on the token for HashMine. Callable by anyone.
    function harvest() external nonReentrant returns (uint256 spent, uint256 tokensOut) {
        address token_ = token;
        if (token_ == address(0)) revert ZeroAddress();
        uint256 nextAt = lastHarvestAt + HARVEST_INTERVAL;
        // Intentional time gate; sequencer timestamp drift of seconds does not matter for a 12 s interval.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < nextAt) revert HarvestTooSoon(nextAt);
        lastHarvestAt = block.timestamp;

        IPonsFactory.LaunchedToken memory launched = factory.getLaunchedToken(token_);
        PonsGraduationPhase phase = launched.phase;
        if (phase == PonsGraduationPhase.NotGraduated) {
            try IPonsCurve(curve).sweepFees(0) {} catch {}
        } else if (phase == PonsGraduationPhase.PoolCreated) {
            try memeHook.sweepPoolFees(_poolKey(launched).toId(), 0, 0) {} catch {}
        }
        try feeEscrow.claim() {} catch {}

        uint256 available = address(this).balance;
        if (available >= MIN_HARVEST) {
            if (phase == PonsGraduationPhase.NotGraduated) (spent, tokensOut) = _buyOnCurve(available);
            else if (phase == PonsGraduationPhase.PoolCreated) (spent, tokensOut) = _buyOnPool(launched, available);
        }
        emit Harvested(available, spent, tokensOut, phase);
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

    function _buyOnCurve(uint256 available) private returns (uint256 spent, uint256 tokensOut) {
        IPonsCurve curve_ = IPonsCurve(curve);
        (uint256 quoteReserve, uint256 tokenReserve) = curve_.getReserves();
        uint256 keepBps = 10_000 - curve_.feeBps() - curve_.creatorTaxBps();
        uint256 maxGross = quoteReserve * CURVE_MAX_NET_PPM * 10_000 / (1_000_000 * keepBps);
        uint256 gross = available < maxGross ? available : maxGross;
        uint256 net = gross * keepBps / 10_000;
        uint256 minOut = tokenReserve * net / (quoteReserve + net) * CURVE_MIN_OUT_BPS / 10_000;

        IERC20 token_ = IERC20(token);
        address mine = address(hashMine);
        uint256 tokensBefore = token_.balanceOf(mine);
        uint256 ethBefore = address(this).balance;
        try curve_.buy{value: gross}(gross, minOut, mine) {}
        catch {
            return (0, 0);
        }
        spent = ethBefore - address(this).balance;
        tokensOut = token_.balanceOf(mine) - tokensBefore;
    }

    function _buyOnPool(IPonsFactory.LaunchedToken memory launched, uint256 available)
        private
        returns (uint256 spent, uint256 tokensOut)
    {
        PoolKey memory key = _poolKey(launched);
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(key.toId());
        // casting to 'uint160' is safe because the result is a fraction of the uint160 sqrtPriceX96 it scales
        // forge-lint: disable-next-line(unsafe-typecast)
        uint160 limit = uint160(uint256(sqrtPriceX96) * POOL_SQRT_PRICE_FLOOR_PPM / 1_000_000);
        try poolManager.unlock(abi.encode(key, available, limit)) returns (bytes memory result) {
            (spent, tokensOut) = abi.decode(result, (uint256, uint256));
        } catch {
            return (0, 0);
        }
    }

    /// @notice Uniswap v4 callback: exact-input ETH -> token swap, tokens delivered to HashMine.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (PoolKey memory key, uint256 amount, uint160 limit) = abi.decode(data, (PoolKey, uint256, uint160));
        BalanceDelta delta = poolManager.swap(
            key,
            // casting to 'int256' is safe because amount is this contract's ETH balance, far below 2**255
            // forge-lint: disable-next-line(unsafe-typecast)
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -int256(amount), sqrtPriceLimitX96: limit}),
            ""
        );
        uint256 spent = uint256(uint128(-delta.amount0()));
        uint256 tokensOut = uint256(uint128(delta.amount1()));
        if (spent != 0) poolManager.settle{value: spent}();
        if (tokensOut != 0) poolManager.take(key.currency1, address(hashMine), tokensOut);
        return abi.encode(spent, tokensOut);
    }

    function _poolKey(IPonsFactory.LaunchedToken memory launched) private view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(launched.token),
            fee: launched.poolFee,
            tickSpacing: launched.tickSpacing,
            hooks: IHooks(address(memeHook))
        });
    }
}
