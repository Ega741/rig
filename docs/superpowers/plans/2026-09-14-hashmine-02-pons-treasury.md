# PonsTreasury Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Контракт `PonsTreasury`. Он запускает токен на PONS V2, сам получает creator fee, выкупает токен в `HashMine` (сначала на curve, после graduation — в пуле Uniswap v4) и мигрирует получателя комиссий с таймлоком. Всё проверяется на форке mainnet Robinhood Chain.

**Architecture:** `PonsTreasury` — единственный контракт, который знает про PONS и Uniswap v4. Адреса хука, escrow и PoolManager он читает из фабрики PONS в конструкторе. `HashMine` создаётся внутри `launch()` с production-параметрами. Интерфейсы PONS — минимальные, в `src/interfaces/IPons.sol`. Тесты идут против настоящих контрактов PONS на форке с закреплённым блоком.

**Tech Stack:** Foundry 1.7.1, Solidity 0.8.26 (`cancun`), OpenZeppelin v5.1.0 (`Ownable2Step`, `ReentrancyGuard`), Uniswap v4-core v4.0.0.

**Спека:** `docs/superpowers/specs/2026-09-14-hashmine-design.md`, §4. **Git:** коммиты только по команде пользователя; в конце задач — Checkpoint (`git status`).

**Предусловия (проверено 2026-09-14):**
- форк работает: запуск через фабрику из контракта, покупка на 1 ETH, `sweepFees` + `claim` дали ровно 0.027 ETH;
- v4-core `v4.0.0` установлен в `contracts/lib/v4-core`;
- блок форка `62_704_000`.

**Команды тестов:**
- юнит: `forge test --no-match-path 'test/fork/*'`;
- форк: `forge test --match-path 'test/fork/*'`.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `contracts/foundry.toml` | + ремаппинг `@uniswap/v4-core/` |
| `contracts/src/interfaces/IPons.sol` | Минимальные интерфейсы фабрики, curve, хука и escrow PONS V2 |
| `contracts/src/PonsTreasury.sol` | Запуск, harvest (curve и пул), миграция |
| `contracts/test/fork/PonsForkBase.sol` | Форк, запуск, хелперы сделок и graduation |
| `contracts/test/fork/PoolSwapper.sol` | Тестовый роутер для сделок трейдера в пуле v4 |
| `contracts/test/fork/PonsTreasuryLaunch.t.sol` | Тесты запуска |
| `contracts/test/fork/PonsTreasuryHarvest.t.sol` | Тесты harvest |
| `contracts/test/fork/PonsTreasuryMigration.t.sol` | Тесты миграции |

---

### Task 1: Ремаппинг v4-core и интерфейсы PONS

**Files:**
- Modify: `contracts/foundry.toml` (массив `remappings`)
- Create: `contracts/src/interfaces/IPons.sol`

- [ ] **Step 1: Добавить ремаппинг** — в `remappings` добавить строку `"@uniswap/v4-core/=lib/v4-core/",`.

- [ ] **Step 2: Записать `contracts/src/interfaces/IPons.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

/// @notice Graduation phases of a PONS V2 launch.
enum PonsGraduationPhase {
    NotGraduated,
    Swept,
    PoolCreated,
    Rescued
}

/// @notice Minimal surface of the PONS V2 launch factory on Robinhood Chain.
/// @dev Shapes follow github.com/ponsdotdev/ponsfamily contractsV2; checked against mainnet in fork tests.
interface IPonsFactory {
    struct Socials {
        string twitter;
        string telegram;
        string discord;
        string website;
        string farcaster;
    }

    struct TokenParams {
        string name;
        string symbol;
        string logo;
        string description;
        Socials socials;
        address creatorFeeRecipient;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        bytes32 expectedEconomics;
        bytes32 salt;
    }

    struct LaunchedToken {
        address token;
        address curve;
        address deployer;
        address creatorFeeRecipient;
        address pairToken;
        uint256 graduationThreshold;
        uint24 poolFee;
        int24 tickSpacing;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        PonsGraduationPhase phase;
        uint256 sweptQuote;
        uint256 sweptTokens;
        uint256 sweptAt;
        bool exists;
    }

    function launchToken(TokenParams calldata params, uint256 launchConfigId, address pairToken)
        external
        payable
        returns (address token, address curve);
    function launchFee() external view returns (uint256);
    function previewLaunchEconomics(uint256 launchConfigId, address pairToken) external view returns (bytes32);
    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
    function transferCreatorFeeRecipient(address token, address newRecipient) external;
    function graduate(address token) external;
    function createGraduatedPool(address token) external returns (uint256 positionId);
    function poolManager() external view returns (address);
    function memeHook() external view returns (address);
    function feeEscrow() external view returns (address);
}

interface IPonsCurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut);
    function sweepFees(uint256 minBuybackTokensOut) external;
    function getReserves() external view returns (uint256 quoteReserve, uint256 tokenReserve);
    function feeBps() external view returns (uint256);
    function creatorTaxBps() external view returns (uint256);
}

interface IPonsMemeHook {
    function sweepPoolFees(PoolId poolId, uint256 minConversionQuoteOut, uint256 minBuybackTokensOut) external;
    function feeSweepOperator() external view returns (address);
    function pendingCreatorTax(PoolId poolId, address currency) external view returns (uint256);
}

interface IPonsFeeEscrow {
    function claim() external returns (uint256 amount);
    function balanceOf(address recipient) external view returns (uint256);
}
```

- [ ] **Step 3: Сборка**

Run: `cd ~/Desktop/rig/contracts && forge build`
Expected: `Compiler run successful`.

- [ ] **Step 4: Checkpoint** — `git status --short`.

---

### Task 2: Запуск — конструктор, `launch`, форк-база

**Files:**
- Create: `contracts/test/fork/PonsForkBase.sol`, `contracts/test/fork/PonsTreasuryLaunch.t.sol`
- Create: `contracts/src/PonsTreasury.sol`

- [ ] **Step 1: Записать `contracts/test/fork/PonsForkBase.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PonsTreasury} from "../../src/PonsTreasury.sol";
import {HashMine} from "../../src/HashMine.sol";
import {IPonsFactory, IPonsCurve, PonsGraduationPhase} from "../../src/interfaces/IPons.sol";

abstract contract PonsForkBase is Test {
    uint256 internal constant FORK_BLOCK = 62_704_000;
    IPonsFactory internal constant FACTORY = IPonsFactory(0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e);

    PonsTreasury internal treasury;
    IERC20 internal token;
    IPonsCurve internal curve;
    HashMine internal mine;
    address internal trader = makeAddr("trader");

    function setUp() public virtual {
        vm.createSelectFork("robinhood", FORK_BLOCK);
        treasury = new PonsTreasury(address(this), FACTORY);
        PonsTreasury.LaunchInput memory input = _launchInput();
        treasury.launch{value: FACTORY.launchFee()}(input);
        token = IERC20(treasury.token());
        curve = IPonsCurve(treasury.curve());
        mine = treasury.hashMine();
        vm.deal(trader, 100 ether);
        vm.warp(block.timestamp + 10); // past the 3 s snipe-tax window
    }

    function _launchInput() internal view returns (PonsTreasury.LaunchInput memory input) {
        input.name = "HashMine Test";
        input.symbol = "HMT";
        input.expectedEconomics = FACTORY.previewLaunchEconomics(0, address(0));
        input.salt = keccak256("hashmine-fork-test");
    }

    function _curveBuy(uint256 amount) internal returns (uint256 tokensOut) {
        vm.prank(trader);
        tokensOut = curve.buy{value: amount}(amount, 0, trader);
    }

    function _phase() internal view returns (PonsGraduationPhase) {
        return FACTORY.getLaunchedToken(address(token)).phase;
    }

    /// @dev Buys through the reserved allocation, then runs both graduation phases if auto-graduation did not.
    function _graduate() internal {
        _curveBuy(10 ether);
        if (_phase() == PonsGraduationPhase.NotGraduated) FACTORY.graduate(address(token));
        if (_phase() == PonsGraduationPhase.Swept) FACTORY.createGraduatedPool(address(token));
        assertEq(uint8(_phase()), uint8(PonsGraduationPhase.PoolCreated), "pool created");
    }

    function _poolKey() internal view returns (PoolKey memory) {
        IPonsFactory.LaunchedToken memory info = FACTORY.getLaunchedToken(address(token));
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token)),
            fee: info.poolFee,
            tickSpacing: info.tickSpacing,
            hooks: IHooks(address(treasury.memeHook()))
        });
    }

    function _nextHarvestWindow() internal {
        vm.warp(block.timestamp + treasury.HARVEST_INTERVAL());
    }
}
```

- [ ] **Step 2: Записать `contracts/test/fork/PonsTreasuryLaunch.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PonsForkBase} from "./PonsForkBase.sol";
import {PonsTreasury} from "../../src/PonsTreasury.sol";
import {IPonsFactory, PonsGraduationPhase} from "../../src/interfaces/IPons.sol";

contract PonsTreasuryLaunchTest is PonsForkBase {
    function test_launch_registersTreasuryAsCreatorWithTwoPercentTax() public view {
        IPonsFactory.LaunchedToken memory info = FACTORY.getLaunchedToken(address(token));
        assertEq(info.token, address(token));
        assertEq(info.curve, address(curve));
        assertEq(info.deployer, address(treasury));
        assertEq(info.creatorFeeRecipient, address(treasury));
        assertEq(info.creatorTaxBps, 200);
        assertFalse(info.buybackEnabled);
        assertEq(uint8(info.phase), uint8(PonsGraduationPhase.NotGraduated));
        assertEq(token.totalSupply(), 1e27);
    }

    function test_launch_deploysHashMineWithProductionParams() public view {
        assertEq(address(mine.token()), address(token));
        assertEq(mine.roundLength(), 600);
        assertEq(mine.releaseBps(), 48);
        assertEq(mine.targetShares(), 4096);
        assertEq(mine.minDifficultyFloor(), 20);
    }

    function test_launch_readsPonsDependenciesFromFactory() public view {
        assertEq(address(treasury.poolManager()), FACTORY.poolManager());
        assertEq(address(treasury.memeHook()), FACTORY.memeHook());
        assertEq(address(treasury.feeEscrow()), FACTORY.feeEscrow());
    }

    function test_launch_onlyOnce() public {
        PonsTreasury.LaunchInput memory input = _launchInput();
        uint256 fee = FACTORY.launchFee();
        vm.expectRevert(PonsTreasury.AlreadyLaunched.selector);
        treasury.launch{value: fee}(input);
    }

    function test_launch_onlyOwner() public {
        PonsTreasury fresh = new PonsTreasury(address(this), FACTORY);
        PonsTreasury.LaunchInput memory input = _launchInput();
        uint256 fee = FACTORY.launchFee();
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", trader));
        fresh.launch{value: fee}(input);
    }
}
```

- [ ] **Step 3: Убедиться, что падает**

Run: `cd ~/Desktop/rig/contracts && forge test --match-path 'test/fork/*'`
Expected: FAIL компиляции — `Source "../../src/PonsTreasury.sol" not found`.

- [ ] **Step 4: Записать `contracts/src/PonsTreasury.sol` (запуск)**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {HashMine} from "./HashMine.sol";
import {IPonsFactory, IPonsMemeHook, IPonsFeeEscrow} from "./interfaces/IPons.sol";

/// @title PonsTreasury
/// @notice Launches the token on PONS V2 as its own creator-fee recipient, turns every creator fee into a
/// buyback of the token for HashMine, and can hand the fee stream to a new contract only behind a 7-day
/// timelock. It has no function that pays ETH or tokens to the owner.
/// @dev Spec: docs/superpowers/specs/2026-09-14-hashmine-design.md, section 4.
contract PonsTreasury is Ownable2Step, ReentrancyGuard {
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

    event Launched(address indexed token, address indexed curve, address hashMine);

    error ZeroAddress();
    error AlreadyLaunched();

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
}
```

`_nextHarvestWindow` в базе ссылается на `HARVEST_INTERVAL`, которого на этом шаге ещё нет. Поэтому в шаге 4 временно добавить в контракт `uint256 public constant HARVEST_INTERVAL = 12;` рядом с `LAUNCH_CONFIG_ID` — Task 3 его использует.

- [ ] **Step 5: Прогнать форк-тесты запуска**

Run: `cd ~/Desktop/rig/contracts && forge test --match-path 'test/fork/PonsTreasuryLaunch.t.sol' -vv`
Expected: `5 passed; 0 failed`. Первый прогон долгий (минуты, RPC-кэш), повторный — секунды.

- [ ] **Step 6: Checkpoint** — `git status --short`.

---

### Task 3: harvest на curve

**Files:**
- Create: `contracts/test/fork/PonsTreasuryHarvest.t.sol`
- Modify: `contracts/src/PonsTreasury.sol`

- [ ] **Step 1: Записать `contracts/test/fork/PonsTreasuryHarvest.t.sol` (часть curve)**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PonsForkBase} from "./PonsForkBase.sol";
import {PonsTreasury} from "../../src/PonsTreasury.sol";

contract PonsTreasuryHarvestTest is PonsForkBase {
    function test_harvest_beforeAnyTrade_buysNothing() public {
        (uint256 spent, uint256 tokensOut) = treasury.harvest();
        assertEq(spent, 0);
        assertEq(tokensOut, 0);
        assertEq(token.balanceOf(address(mine)), 0);
    }

    function test_harvest_tooSoon_reverts() public {
        treasury.harvest();
        vm.expectRevert(abi.encodeWithSelector(PonsTreasury.HarvestTooSoon.selector, block.timestamp + 12));
        treasury.harvest();
    }

    function test_harvest_curve_claimsCreatorFeesAndBuysForHashMine() public {
        _curveBuy(1 ether);
        (uint256 quoteBefore, uint256 tokensBefore) = curve.getReserves();

        (uint256 spent, uint256 tokensOut) = treasury.harvest();

        assertGt(spent, 0);
        assertGt(tokensOut, 0);
        assertEq(token.balanceOf(address(mine)), tokensOut);
        // A 1 ETH buy pays 2% creator tax + 70% of the 1% base fee = 0.027 ETH to the treasury.
        assertEq(address(treasury).balance, 0.027 ether - spent);
        (uint256 quoteAfter, uint256 tokensAfter) = curve.getReserves();
        // Curve price quote/token moved by at most 1%.
        assertLe(quoteAfter * tokensBefore * 10_000, quoteBefore * tokensAfter * 10_100);
    }

    function test_harvest_curve_capsSpendAndLeavesRestForNextHarvest() public {
        _curveBuy(1 ether);
        (uint256 spent,) = treasury.harvest();
        uint256 left = address(treasury).balance;
        assertGt(left, 0, "cap left ETH for later");

        _nextHarvestWindow();
        (uint256 spent2, uint256 tokensOut2) = treasury.harvest();
        assertGt(spent2, 0);
        assertGt(tokensOut2, 0);
        // The second harvest also collected 2.7% of the first harvest's own buy.
        assertApproxEqAbs(address(treasury).balance, left + spent * 27 / 1000 - spent2, 3);
    }
}
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd ~/Desktop/rig/contracts && forge test --match-path 'test/fork/PonsTreasuryHarvest.t.sol'`
Expected: FAIL компиляции — `Member "harvest" not found`.

- [ ] **Step 3: Добавить harvest (curve) в `PonsTreasury.sol`**

Импорты заменить на:

```solidity
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {HashMine} from "./HashMine.sol";
import {IPonsFactory, IPonsCurve, IPonsMemeHook, IPonsFeeEscrow, PonsGraduationPhase} from "./interfaces/IPons.sol";
```

Константы после `LAUNCH_CONFIG_ID` (заменяют временный `HARVEST_INTERVAL`):

```solidity
    uint256 public constant HARVEST_INTERVAL = 12;
    uint256 public constant MIN_HARVEST = 0.001 ether;
    /// @dev sqrt(1.01) - 1 in parts per million, rounded down: a curve buy whose net input is at most
    /// this share of the quote reserve moves the curve price by at most 1%.
    uint256 public constant CURVE_MAX_NET_PPM = 4_987;
    uint256 public constant CURVE_MIN_OUT_BPS = 9_950;
```

Состояние после `hashMine`:

```solidity
    uint256 public lastHarvestAt;
```

Событие и ошибка:

```solidity
    event Harvested(uint256 ethAvailable, uint256 ethSpent, uint256 tokensOut, PonsGraduationPhase phase);

    error HarvestTooSoon(uint256 nextAt);
```

Функции после `launch`:

```solidity
    /// @notice Pulls creator fees from PONS and spends them on the token for HashMine. Callable by anyone.
    function harvest() external nonReentrant returns (uint256 spent, uint256 tokensOut) {
        address token_ = token;
        if (token_ == address(0)) revert ZeroAddress();
        uint256 nextAt = lastHarvestAt + HARVEST_INTERVAL;
        if (block.timestamp < nextAt) revert HarvestTooSoon(nextAt);
        lastHarvestAt = block.timestamp;

        IPonsFactory.LaunchedToken memory launched = factory.getLaunchedToken(token_);
        PonsGraduationPhase phase = launched.phase;
        if (phase == PonsGraduationPhase.NotGraduated) {
            try IPonsCurve(curve).sweepFees(0) {} catch {}
        }
        try feeEscrow.claim() {} catch {}

        uint256 available = address(this).balance;
        if (available >= MIN_HARVEST) {
            if (phase == PonsGraduationPhase.NotGraduated) (spent, tokensOut) = _buyOnCurve(available);
        }
        emit Harvested(available, spent, tokensOut, phase);
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
```

- [ ] **Step 4: Прогнать**

Run: `cd ~/Desktop/rig/contracts && forge test --match-path 'test/fork/PonsTreasury*.t.sol' -vv`
Expected: Launch 5 + Harvest 4 = `9 passed; 0 failed`.

- [ ] **Step 5: Checkpoint** — `git status --short`.

---

### Task 4: harvest в пуле Uniswap v4

**Files:**
- Create: `contracts/test/fork/PoolSwapper.sol`
- Modify: `contracts/test/fork/PonsTreasuryHarvest.t.sol`, `contracts/src/PonsTreasury.sol`

- [ ] **Step 1: Записать `contracts/test/fork/PoolSwapper.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @notice Exact-input ETH/token swaps for traders in fork tests.
contract PoolSwapper is IUnlockCallback {
    IPoolManager public immutable manager;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    receive() external payable {}

    function buy(PoolKey memory key, address recipient) external payable returns (uint256 tokensOut) {
        tokensOut = abi.decode(manager.unlock(abi.encode(key, true, msg.value, recipient)), (uint256));
    }

    function sell(PoolKey memory key, uint256 tokensIn, address recipient) external returns (uint256 ethOut) {
        IERC20(Currency.unwrap(key.currency1)).transferFrom(msg.sender, address(this), tokensIn);
        ethOut = abi.decode(manager.unlock(abi.encode(key, false, tokensIn, recipient)), (uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "not manager");
        (PoolKey memory key, bool zeroForOne, uint256 amountIn, address recipient) =
            abi.decode(data, (PoolKey, bool, uint256, address));
        uint160 limit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        BalanceDelta delta = manager.swap(
            key, IPoolManager.SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: limit}), ""
        );
        if (zeroForOne) {
            manager.settle{value: uint256(uint128(-delta.amount0()))}();
            uint256 out = uint256(uint128(delta.amount1()));
            manager.take(key.currency1, recipient, out);
            return abi.encode(out);
        }
        uint256 paid = uint256(uint128(-delta.amount1()));
        manager.sync(key.currency1);
        IERC20(Currency.unwrap(key.currency1)).transfer(address(manager), paid);
        manager.settle();
        uint256 ethOut = uint256(uint128(delta.amount0()));
        manager.take(key.currency0, recipient, ethOut);
        return abi.encode(ethOut);
    }
}
```

- [ ] **Step 2: Добавить в `PonsTreasuryHarvest.t.sol` тесты пула**

Импорты добавить:

```solidity
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolSwapper} from "./PoolSwapper.sol";
```

В начало контракта:

```solidity
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
```

Тесты в конец контракта:

```solidity
    function _sqrtPrice(PoolKey memory key) internal view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,) = treasury.poolManager().getSlot0(key.toId());
    }

    function test_harvest_pool_afterGraduation_buysWithinOnePercent() public {
        _graduate();
        PoolKey memory key = _poolKey();
        uint160 priceBefore = _sqrtPrice(key);

        (uint256 spent, uint256 tokensOut) = treasury.harvest();

        assertGt(spent, 0, "graduation-era fees spent");
        assertGt(tokensOut, 0);
        assertEq(token.balanceOf(address(mine)), tokensOut);
        // zeroForOne lowers sqrtPrice; floor is sqrt(0.99).
        assertGe(uint256(_sqrtPrice(key)) * 1_000_000, uint256(priceBefore) * 994_987);
    }

    function test_harvest_pool_sellFeesAreSweptWithoutOperator() public {
        _graduate();
        treasury.harvest();
        PoolKey memory key = _poolKey();
        PoolSwapper swapper = new PoolSwapper(treasury.poolManager());
        uint256 tokensIn = token.balanceOf(trader) / 20;

        // Flush memecoin fees left by the treasury's own buy, so only the sell's ETH fee is pending.
        vm.prank(treasury.memeHook().feeSweepOperator());
        treasury.memeHook().sweepPoolFees(key.toId(), 0, 0);
        _nextHarvestWindow();
        treasury.harvest();

        vm.startPrank(trader);
        token.approve(address(swapper), tokensIn);
        swapper.sell(key, tokensIn, trader);
        vm.stopPrank();
        uint256 escrowBefore = treasury.feeEscrow().balanceOf(address(treasury));

        _nextHarvestWindow();
        uint256 mineBefore = token.balanceOf(address(mine));
        (uint256 spent, uint256 tokensOut) = treasury.harvest();

        assertEq(escrowBefore, 0, "sell fee not yet in escrow");
        assertEq(treasury.feeEscrow().balanceOf(address(treasury)), 0, "harvest swept and claimed it");
        assertGt(spent, 0);
        assertEq(token.balanceOf(address(mine)) - mineBefore, tokensOut);
    }

    function test_harvest_pool_buyFeesWaitForOperator() public {
        _graduate();
        treasury.harvest();
        PoolKey memory key = _poolKey();
        PoolSwapper swapper = new PoolSwapper(treasury.poolManager());

        vm.prank(trader);
        swapper.buy{value: 1 ether}(key, trader);
        _nextHarvestWindow();
        treasury.harvest();
        assertGt(treasury.memeHook().pendingCreatorTax(key.toId(), address(token)), 0, "memecoin tax stays pending");

        vm.prank(treasury.memeHook().feeSweepOperator());
        treasury.memeHook().sweepPoolFees(key.toId(), 0, 0);
        assertGt(treasury.feeEscrow().balanceOf(address(treasury)), 0, "operator credited ETH");

        _nextHarvestWindow();
        treasury.harvest();
        assertEq(treasury.feeEscrow().balanceOf(address(treasury)), 0, "treasury claimed it");
    }
```

- [ ] **Step 3: Убедиться, что падают**

Run: `cd ~/Desktop/rig/contracts && forge test --match-path 'test/fork/PonsTreasuryHarvest.t.sol' -vv`
Expected: 3 новых теста FAIL (`graduation-era fees spent` / `memecoin tax stays pending` / escrow-проверки): harvest ещё не покупает в пуле и не свипает хук.

- [ ] **Step 4: Добавить в `PonsTreasury.sol` путь пула**

Импорты добавить:

```solidity
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
```

Объявление контракта: `contract PonsTreasury is Ownable2Step, ReentrancyGuard, IUnlockCallback {` и первыми строками тела:

```solidity
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
```

Константа после `CURVE_MIN_OUT_BPS`:

```solidity
    /// @dev sqrt(0.99) in parts per million, rounded up: one harvest lowers the pool price by at most 1%.
    uint256 public constant POOL_SQRT_PRICE_FLOOR_PPM = 994_988;
```

Ошибка: `error NotPoolManager();`

В `harvest` заменить блок свипа и блок покупки на:

```solidity
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
```

Функции после `_buyOnCurve`:

```solidity
    function _buyOnPool(IPonsFactory.LaunchedToken memory launched, uint256 available)
        private
        returns (uint256 spent, uint256 tokensOut)
    {
        PoolKey memory key = _poolKey(launched);
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(key.toId());
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
```

- [ ] **Step 5: Прогнать**

Run: `cd ~/Desktop/rig/contracts && forge test --match-path 'test/fork/PonsTreasury*.t.sol' -vv`
Expected: Launch 5 + Harvest 7 = `12 passed; 0 failed`.

- [ ] **Step 6: Checkpoint** — `git status --short`.

---

### Task 5: Миграция получателя комиссий

**Files:**
- Create: `contracts/test/fork/PonsTreasuryMigration.t.sol`
- Modify: `contracts/src/PonsTreasury.sol`

- [ ] **Step 1: Записать `contracts/test/fork/PonsTreasuryMigration.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PonsForkBase} from "./PonsForkBase.sol";
import {PonsTreasury} from "../../src/PonsTreasury.sol";

contract PonsTreasuryMigrationTest is PonsForkBase {
    address internal nextRecipient = makeAddr("nextRecipient");

    function test_migration_executesAfterDelayWithinWindow() public {
        treasury.proposeMigration(nextRecipient);
        uint256 eta = treasury.migrationEta();
        assertEq(eta, block.timestamp + 7 days);

        vm.expectRevert(abi.encodeWithSelector(PonsTreasury.MigrationNotReady.selector, eta));
        treasury.executeMigration();

        vm.warp(eta);
        treasury.executeMigration();
        assertEq(FACTORY.getLaunchedToken(address(token)).creatorFeeRecipient, nextRecipient);
        assertEq(treasury.pendingRecipient(), address(0));
        assertEq(treasury.migrationEta(), 0);
    }

    function test_migration_expiresAfterWindow() public {
        treasury.proposeMigration(nextRecipient);
        uint256 eta = treasury.migrationEta();
        vm.warp(eta + 3 days + 1);
        vm.expectRevert(abi.encodeWithSelector(PonsTreasury.MigrationExpired.selector, eta + 3 days));
        treasury.executeMigration();
    }

    function test_migration_cancelClearsProposal() public {
        treasury.proposeMigration(nextRecipient);
        treasury.cancelMigration();
        assertEq(treasury.pendingRecipient(), address(0));
        vm.expectRevert(PonsTreasury.NoPendingMigration.selector);
        treasury.executeMigration();
    }

    function test_migration_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", trader));
        treasury.proposeMigration(nextRecipient);
    }

    function test_migration_rejectsZeroRecipient() public {
        vm.expectRevert(PonsTreasury.ZeroAddress.selector);
        treasury.proposeMigration(address(0));
    }
}
```

- [ ] **Step 2: Убедиться, что падает**

Run: `cd ~/Desktop/rig/contracts && forge test --match-path 'test/fork/PonsTreasuryMigration.t.sol'`
Expected: FAIL компиляции — `Member "proposeMigration" not found`.

- [ ] **Step 3: Добавить миграцию в `PonsTreasury.sol`**

Константы после `POOL_SQRT_PRICE_FLOOR_PPM`:

```solidity
    uint256 public constant MIGRATION_DELAY = 7 days;
    uint256 public constant MIGRATION_WINDOW = 3 days;
```

Состояние после `lastHarvestAt`:

```solidity
    address public pendingRecipient;
    uint256 public migrationEta;
```

События и ошибки:

```solidity
    event MigrationProposed(address indexed newRecipient, uint256 eta);
    event MigrationCancelled(address indexed newRecipient);
    event MigrationExecuted(address indexed newRecipient);

    error NoPendingMigration();
    error MigrationNotReady(uint256 eta);
    error MigrationExpired(uint256 deadline);
```

Функции после `harvest`:

```solidity
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
        if (block.timestamp < eta) revert MigrationNotReady(eta);
        if (block.timestamp > eta + MIGRATION_WINDOW) revert MigrationExpired(eta + MIGRATION_WINDOW);
        delete pendingRecipient;
        delete migrationEta;
        factory.transferCreatorFeeRecipient(token, newRecipient);
        emit MigrationExecuted(newRecipient);
    }
```

- [ ] **Step 4: Прогнать**

Run: `cd ~/Desktop/rig/contracts && forge test --match-path 'test/fork/*' -vv`
Expected: Launch 5 + Harvest 7 + Migration 5 = `17 passed; 0 failed`.

- [ ] **Step 5: Checkpoint** — `git status --short`.

---

### Task 6: Размер байткода и полный прогон

- [ ] **Step 1: Размер**

Run: `cd ~/Desktop/rig/contracts && forge build --sizes | grep -E "PonsTreasury|HashMine"`
Expected: `PonsTreasury` Runtime Size < 24,576 B (EIP-170). Если больше — вынести создание `HashMine` в отдельную фабрику (спека §4.1) отдельной задачей.

- [ ] **Step 2: Юнит + форк**

Run: `cd ~/Desktop/rig/contracts && forge test --no-match-path 'test/fork/*' && forge test --match-path 'test/fork/*'`
Expected: юнит `37 passed`, форк `17 passed`, 0 failed.

- [ ] **Step 3: Checkpoint** — `git status --short`.

---

## Self-Review (выполнен при написании)

- **Покрытие спеки §4:**
  - запуск с `creatorFeeRecipient = this`, tax 200, buyback off, `expectedEconomics` — Task 2;
  - деплой HashMine с параметрами §5.1 — Task 2;
  - harvest: интервал 12 с, свипы в try/catch, claim, порог 0.001 ETH, лимит 1% на curve и в пуле, фаза из фабрики, пропуск фазы `Swept` — Task 3–4;
  - миграция 7 дней + окно 3 дня, cancel, onlyOwner — Task 5;
  - EIP-170 — Task 6;
  - риск §9 п.2 (комиссии с покупок ждут оператора) закреплён тестом `test_harvest_pool_buyFeesWaitForOperator`.
- **Решения поверх спеки:** покупка на curve и своп в пуле обёрнуты в try/catch, чтобы откат покупки (например, curve уже на пороге graduation) не отменял свип и claim. `harvest` до запуска откатывается с `ZeroAddress`.
- **Типы:** `LaunchInput`, `IPonsFactory.LaunchedToken`, `PonsGraduationPhase`, `HARVEST_INTERVAL`, `pendingRecipient`, `migrationEta` одинаковы в контракте и тестах.

---

## Отклонения при исполнении (2026-09-14)

1. **Task 1, шаг 3.** `forge build --skip test` тестовую папку не исключает, отдельной проверки `IPons.sol` не получилось. Интерфейс скомпилировался в зелёном прогоне Task 2.
2. **RPC форка.** Публичный `rpc.mainnet.chain.robinhood.com` хранит состояние только ~3–10 тыс. последних блоков. Замер: на latest−3000 чтение работает, на latest−10000 — `metadata is not found`. Закреплённый форк на нём ломается, как только тест трогает новые слоты. Алиас `robinhood` в `foundry.toml` переключён на `https://robinhood.drpc.org`, который отдаёт состояние на блоках 60 000 000–62 704 000; публичный оставлен как `robinhood_public`.
3. **Task 4, красный прогон.** Первый «RED OK» был ложным: три теста упали на ошибке RPC, а скрипт считал только число FAIL. Причину падения теперь выводит каждый красный прогон. Честный красный получен мутацией: из `harvest` временно вырезаны свип хука и выкуп в пуле. `afterGraduation_buysWithinOnePercent` упал на `graduation-era fees spent: 0 <= 0`, `sellFeesAreSweptWithoutOperator` — на `treasury swept ETH tax itself: 12510638297872340 != 0`. Затем файл восстановлен из бэкапа, `shasum` совпал.
4. **Task 4, тест sell-комиссий перестроен.** Собственный выкуп Treasury в пуле (exact-input ETH→токен) оставляет в хуке комиссию в токене. Пока она висит, свип создателем откатывается с `InternalSwapRequiresOperator()` (`0x31cdb504`). Тест теперь делает sell до любого выкупа Treasury и проверяет, что ETH-налог в хуке после harvest обнулился.
5. **Task 4, свип оператора.** Задеплоенный хук бросает `MinimumOutputRequired()` (`0x3672d25f`, строка 636 `PonsV2MemeHook`), если конвертация токена в ETH вызвана с `minConversionQuoteOut == 0`. В тесте оператор передаёт `1`. `NoBalance()` (`0xc2caa2a6`) — откат `claim()` на пустом escrow, внутри `try/catch` ожидаемый.
6. **`buyFeesWaitForOperator`** не является красным тестом: он проходит и без пути пула, потому что `claim` безусловный. Это регрессионная проверка зависимости от оператора.
