# HashMine Core Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Контракт `HashMine` — пул шар keccak-PoW: раунды, проверка шар, закрытие раунда с выпуском доли пула, расчёт и claim. Без PONS.

**Architecture:** Один контракт `contracts/src/HashMine.sol`, работает с любым ERC-20. Пул наград — баланс токена минус `reserved`. Параметры раунда задаются в конструкторе и хранятся как immutable. Это позволяет тестам работать с маленькой сложностью, а `PonsTreasury` (план 2) — передавать production-значения.

**Tech Stack:** Foundry (forge 1.7.1), Solidity 0.8.26, `evm_version = cancun`, OpenZeppelin Contracts v5.1.0, forge-std.

**Спека:** `docs/superpowers/specs/2026-09-14-hashmine-design.md`, §5.

**Git:** коммиты только по прямой команде пользователя. Вместо шага «Commit» в конце задачи стоит «Checkpoint»: `git status`, сверка списка файлов.

**Серия планов:** 01 — ядро HashMine (этот план); 02 — PonsTreasury и форк-тесты; 03 — симуляция параметров; 04 — браузерный майнер; 05 — выкладка в testnet.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `.gitignore` | Игнор артефактов сборки |
| `contracts/foundry.toml` | Конфиг Foundry: solc, EVM, ремаппинги, fuzz/invariant |
| `contracts/src/HashMine.sol` | Раунды, шары, выпуск, claim |
| `contracts/test/utils/MockERC20.sol` | Токен с `mint` для тестов |
| `contracts/test/utils/ShareFinder.sol` | Поиск валидных nonce в тестах |
| `contracts/test/HashMine.t.sol` | Юнит- и fuzz-тесты |
| `contracts/test/HashMineInvariant.t.sol` | Handler и инварианты |
| `contracts/test/HashMineGas.t.sol` | Замер газа `submit` и `claim` |

Параметры тестов везде: `roundLength = 600`, `releaseBps = 48`, `targetShares = 4`, `minDifficulty = 4` (инвариант-тест: `targetShares = 256`, `minDifficulty = 2`).

---

### Task 1: Каркас Foundry-проекта

**Files:**
- Create: `contracts/foundry.toml`, `.gitignore`
- Create (генерирует forge): `contracts/lib/forge-std`, `contracts/lib/openzeppelin-contracts`

- [ ] **Step 1: Создать проект и зависимости**

```bash
cd ~/Desktop/rig
forge init contracts --no-git --shallow
rm -f contracts/src/Counter.sol contracts/test/Counter.t.sol contracts/script/Counter.s.sol
rm -rf contracts/lib/forge-std
cd contracts
forge install foundry-rs/forge-std --shallow
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --shallow
```

Expected: в `~/Desktop/rig/.gitmodules` две записи с путями `contracts/lib/forge-std` и `contracts/lib/openzeppelin-contracts`. Если `forge install` откажется работать как подмодуль из подпапки, повторить обе установки с флагом `--no-git` и добавить `contracts/lib/` в `.gitignore`.

- [ ] **Step 2: Записать `contracts/foundry.toml`**

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.26"
evm_version = "cancun"
optimizer = true
optimizer_runs = 10000
remappings = [
  "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
  "forge-std/=lib/forge-std/src/",
]

[fuzz]
runs = 256

[invariant]
runs = 64
depth = 64
fail_on_revert = false

[rpc_endpoints]
robinhood = "https://rpc.mainnet.chain.robinhood.com"
robinhood_testnet = "https://rpc.testnet.chain.robinhood.com"
```

- [ ] **Step 3: Записать `.gitignore` в корне репо**

```gitignore
contracts/out/
contracts/cache/
contracts/broadcast/*/31337/
node_modules/
.env
.DS_Store
```

- [ ] **Step 4: Проверить сборку пустого проекта**

Run: `cd ~/Desktop/rig/contracts && forge build`
Expected: `No files changed, compilation skipped` или `Compiler run successful` без ошибок.

- [ ] **Step 5: Checkpoint**

Run: `cd ~/Desktop/rig && git status --short`
Expected: `.gitignore`, `.gitmodules`, `contracts/foundry.toml`, `contracts/lib/...`, `docs/`.

---

### Task 2: Тестовые утилиты

**Files:**
- Create: `contracts/test/utils/MockERC20.sol`
- Create: `contracts/test/utils/ShareFinder.sol`

- [ ] **Step 1: Записать `contracts/test/utils/MockERC20.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

- [ ] **Step 2: Записать `contracts/test/utils/ShareFinder.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Brute-force nonce search for tests. Uses the exact hash layout of HashMine.submit.
library ShareFinder {
    function shareHash(address beneficiary, bytes32 challenge, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(beneficiary, challenge, nonce));
    }

    function leadingZeros(bytes32 h) internal pure returns (uint256 n) {
        uint256 x = uint256(h);
        if (x == 0) return 256;
        while (x >> 255 == 0) {
            x <<= 1;
            ++n;
        }
    }

    /// @notice `count` strictly increasing nonces greater than `from` with at least `difficulty` leading zero bits.
    function find(address beneficiary, bytes32 challenge, uint8 difficulty, uint256 from, uint256 count)
        internal
        pure
        returns (uint256[] memory nonces)
    {
        nonces = new uint256[](count);
        uint256 nonce = from;
        uint256 found;
        uint256 shift = 256 - difficulty;
        while (found < count) {
            ++nonce;
            if (uint256(shareHash(beneficiary, challenge, nonce)) >> shift == 0) nonces[found++] = nonce;
        }
    }

    /// @notice First nonce greater than `from` whose hash has exactly `zeros` leading zero bits.
    function findExact(address beneficiary, bytes32 challenge, uint256 zeros, uint256 from)
        internal
        pure
        returns (uint256 nonce)
    {
        nonce = from;
        while (true) {
            ++nonce;
            if (leadingZeros(shareHash(beneficiary, challenge, nonce)) == zeros) return nonce;
        }
    }
}
```

- [ ] **Step 3: Проверить компиляцию**

Run: `cd ~/Desktop/rig/contracts && forge build`
Expected: `Compiler run successful`.

- [ ] **Step 4: Checkpoint** — `git status --short` показывает два новых файла в `contracts/test/utils/`.

---

### Task 3: Скелет HashMine — параметры, раунды, челлендж, минимальная сложность

**Files:**
- Create: `contracts/src/HashMine.sol`
- Create: `contracts/test/HashMine.t.sol`

- [ ] **Step 1: Написать падающие тесты `contracts/test/HashMine.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HashMine} from "../src/HashMine.sol";
import {MockERC20} from "./utils/MockERC20.sol";
import {ShareFinder} from "./utils/ShareFinder.sol";

contract HashMineTest is Test {
    uint8 internal constant D = 4;
    uint256 internal constant T0 = 1_000_000;

    MockERC20 internal token;
    HashMine internal mine;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        vm.warp(T0);
        token = new MockERC20();
        mine = new HashMine(IERC20(address(token)), _params());
    }

    function _params() internal pure returns (HashMine.Params memory) {
        return HashMine.Params({roundLength: 600, releaseBps: 48, targetShares: 4, minDifficulty: D});
    }

    // ---------------------------------------------------------------- rounds

    function test_constructor_rejectsBadParams() public {
        IERC20 t = IERC20(address(token));
        vm.expectRevert(HashMine.InvalidParams.selector);
        new HashMine(t, HashMine.Params(0, 48, 4, D));
        vm.expectRevert(HashMine.InvalidParams.selector);
        new HashMine(t, HashMine.Params(600, 0, 4, D));
        vm.expectRevert(HashMine.InvalidParams.selector);
        new HashMine(t, HashMine.Params(600, 10_001, 4, D));
        vm.expectRevert(HashMine.InvalidParams.selector);
        new HashMine(t, HashMine.Params(600, 48, 0, D));
        vm.expectRevert(HashMine.InvalidParams.selector);
        new HashMine(t, HashMine.Params(600, 48, 4, 0));
        vm.expectRevert(HashMine.InvalidParams.selector);
        new HashMine(t, HashMine.Params(600, 48, 4, 97));
        vm.expectRevert(HashMine.ZeroAddress.selector);
        new HashMine(IERC20(address(0)), _params());
    }

    function test_rounds_startAtGenesisAndAdvanceEveryRoundLength() public {
        assertEq(mine.genesis(), T0);
        assertEq(mine.currentRound(), 1);
        assertEq(mine.roundStart(1), T0);
        vm.warp(T0 + 599);
        assertEq(mine.currentRound(), 1);
        vm.warp(T0 + 600);
        assertEq(mine.currentRound(), 2);
        assertEq(mine.roundStart(2), T0 + 600);
    }

    // ------------------------------------------------------ challenge / difficulty

    function test_challenge_genesisAnchor() public view {
        bytes32 genesisChallenge = keccak256(abi.encode(address(mine), block.chainid, T0));
        assertEq(mine.genesisChallenge(), genesisChallenge);
        assertEq(mine.challenge(1), keccak256(abi.encode(genesisChallenge, bytes32(0), uint256(1))));
        assertEq(mine.challenge(7), keccak256(abi.encode(genesisChallenge, bytes32(0), uint256(7))));
    }

    function test_minDifficulty_isFloorWithoutWork() public view {
        assertEq(mine.minDifficulty(1), D);
        assertEq(mine.minDifficulty(50), D);
    }
}
```

- [ ] **Step 2: Убедиться, что тесты не компилируются**

Run: `cd ~/Desktop/rig/contracts && forge test --match-contract HashMineTest`
Expected: FAIL — `Source "../src/HashMine.sol" not found` (или аналогичная ошибка импорта).

- [ ] **Step 3: Записать `contracts/src/HashMine.sol` (скелет)**

```solidity
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

    // ------------------------------------------------------------------ views

    function currentRound() public view returns (uint256) {
        return (block.timestamp - genesis) / roundLength + 1;
    }

    function roundStart(uint256 round) external view returns (uint256) {
        return genesis + (round - 1) * roundLength;
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
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `cd ~/Desktop/rig/contracts && forge test --match-contract HashMineTest -vv`
Expected: `4 passed; 0 failed`. Предупреждения о неиспользуемых импортах `SafeERC20`/`SafeCast` на этом шаге допустимы, их использует Task 4–5.

- [ ] **Step 5: Checkpoint** — `git status --short`: новые `contracts/src/HashMine.sol`, `contracts/test/HashMine.t.sol`.

---

### Task 4: submit — проверка и зачёт шар

**Files:**
- Modify: `contracts/src/HashMine.sol` (добавить `submit`, `_activate`, временный `_settle`)
- Modify: `contracts/test/HashMine.t.sol` (добавить хелперы и тесты)

- [ ] **Step 1: Добавить в `HashMineTest` хелперы (сразу после `_params()`)**

```solidity
    function _find(address who, uint8 difficulty, uint256 count) internal view returns (uint256[] memory) {
        uint256 round = mine.currentRound();
        HashMine.Miner memory m = mine.minerState(who);
        uint256 from = m.round == round ? m.lastNonce : 0;
        return ShareFinder.find(who, mine.challenge(round), difficulty, from, count);
    }

    function _submit(address who, uint8 difficulty, uint256 count) internal returns (uint256[] memory nonces) {
        nonces = _find(who, difficulty, count);
        mine.submit(who, mine.currentRound(), difficulty, nonces);
    }

    function _one(uint256 nonce) internal pure returns (uint256[] memory nonces) {
        nonces = new uint256[](1);
        nonces[0] = nonce;
    }

    function _nextRound() internal {
        vm.warp(mine.roundStart(mine.currentRound() + 1));
    }
```

- [ ] **Step 2: Добавить в конец `HashMineTest` падающие тесты submit**

```solidity
    // ----------------------------------------------------------------- submit

    function test_submit_creditsWorkToBeneficiary() public {
        uint256[] memory nonces = _find(alice, D, 3);
        bytes32 lastHash = ShareFinder.shareHash(alice, mine.challenge(1), nonces[2]);
        vm.expectEmit(address(mine));
        emit HashMine.ShareBatch(alice, 1, D, 3, 3 << D, lastHash);
        mine.submit(alice, 1, D, nonces);

        HashMine.Miner memory m = mine.minerState(alice);
        assertEq(m.round, 1);
        assertEq(m.work, 3 << D);
        assertEq(m.lastNonce, nonces[2]);
        assertEq(mine.roundWork(1), 3 << D);
        assertEq(mine.roundInfo(1).seed, lastHash);
        assertEq(mine.lastActiveRound(), 1);
    }

    function test_submit_creditsDeclaredDifficultyNotActualBits() public {
        _submit(alice, D + 2, 1);
        assertEq(mine.minerState(alice).work, 1 << (D + 2));
    }

    function test_submit_anyoneCanSendForBeneficiary() public {
        uint256[] memory nonces = _find(alice, D, 1);
        vm.prank(bob);
        mine.submit(alice, 1, D, nonces);
        assertEq(mine.minerState(alice).work, 1 << D);
        assertEq(mine.minerState(bob).work, 0);
    }

    function test_submit_acceptsExactlyDifficultyBits() public {
        uint256 nonce = ShareFinder.findExact(alice, mine.challenge(1), D, 0);
        mine.submit(alice, 1, D, _one(nonce));
        assertEq(mine.minerState(alice).work, 1 << D);
    }

    function test_submit_rejectsOneBitShort() public {
        uint256 nonce = ShareFinder.findExact(alice, mine.challenge(1), D - 1, 0);
        vm.expectRevert(abi.encodeWithSelector(HashMine.InvalidShare.selector, 0));
        mine.submit(alice, 1, D, _one(nonce));
    }

    function test_submit_rejectsShareOfOtherBeneficiary() public {
        uint256[] memory nonces = _find(alice, 12, 1);
        // Same nonce hashed with bob's address almost surely has < 12 zero bits.
        vm.expectRevert(abi.encodeWithSelector(HashMine.InvalidShare.selector, 0));
        mine.submit(bob, 1, 12, nonces);
    }

    function test_submit_acceptsLastSecondOfRound() public {
        vm.warp(mine.roundStart(2) - 1);
        _submit(alice, D, 1);
        assertEq(mine.roundWork(1), 1 << D);
    }

    function test_submit_rejectsWrongRound() public {
        uint256[] memory nonces = _find(alice, D, 1);
        vm.warp(mine.roundStart(2));
        vm.expectRevert(abi.encodeWithSelector(HashMine.WrongRound.selector, 1, 2));
        mine.submit(alice, 1, D, nonces);
    }

    function test_submit_rejectsDifficultyOutOfRange() public {
        uint256[] memory nonces = _find(alice, D, 1);
        vm.expectRevert(abi.encodeWithSelector(HashMine.BadDifficulty.selector, D - 1, D));
        mine.submit(alice, 1, D - 1, nonces);
        vm.expectRevert(abi.encodeWithSelector(HashMine.BadDifficulty.selector, 97, D));
        mine.submit(alice, 1, 97, nonces);
    }

    function test_submit_rejectsBadNonceCount() public {
        vm.expectRevert(abi.encodeWithSelector(HashMine.BadNonceCount.selector, 0));
        mine.submit(alice, 1, D, new uint256[](0));
        vm.expectRevert(abi.encodeWithSelector(HashMine.BadNonceCount.selector, 65));
        mine.submit(alice, 1, D, new uint256[](65));
    }

    function test_submit_rejectsZeroBeneficiary() public {
        vm.expectRevert(HashMine.ZeroAddress.selector);
        mine.submit(address(0), 1, D, _one(1));
    }

    function test_submit_rejectsNonIncreasingWithinBatch() public {
        uint256[] memory nonces = _find(alice, D, 2);
        (nonces[0], nonces[1]) = (nonces[1], nonces[0]);
        vm.expectRevert(abi.encodeWithSelector(HashMine.NonceNotIncreasing.selector, 1));
        mine.submit(alice, 1, D, nonces);
    }

    function test_submit_rejectsReplayInSameRound() public {
        uint256[] memory nonces = _submit(alice, D, 1);
        vm.expectRevert(abi.encodeWithSelector(HashMine.NonceNotIncreasing.selector, 0));
        mine.submit(alice, 1, D, nonces);
    }

    function test_submit_newRoundAllowsSmallNoncesAgain() public {
        uint256[] memory big = ShareFinder.find(alice, mine.challenge(1), D, 1_000_000, 1);
        mine.submit(alice, 1, D, big);
        _nextRound();
        uint256[] memory small = ShareFinder.find(alice, mine.challenge(2), D, 0, 1);
        assertLt(small[0], big[0]);
        mine.submit(alice, 2, D, small);
        assertEq(mine.minerState(alice).round, 2);
    }

    function test_challenge_chainsFromLastActiveRound() public {
        bytes32 c1 = mine.challenge(1);
        uint256[] memory nonces = _submit(alice, D, 2);
        bytes32 seed = ShareFinder.shareHash(alice, c1, nonces[1]);
        assertEq(mine.challenge(1), c1, "stored on activation");
        assertEq(mine.challenge(2), keccak256(abi.encode(c1, seed, uint256(2))));
        assertEq(mine.challenge(5), keccak256(abi.encode(c1, seed, uint256(5))), "empty rounds keep the anchor");
    }

    function test_minDifficulty_followsWorkAndDecaysOverEmptyRounds() public {
        // 64 shares at D=4: work 1024; ceil(log2(ceilDiv(1024, 4))) = 8.
        _submit(alice, D, 64);
        assertEq(mine.minDifficulty(1), D, "active round keeps its own minimum");
        assertEq(mine.minDifficulty(2), 8);
        assertEq(mine.minDifficulty(3), 7);
        assertEq(mine.minDifficulty(5), 5);
        assertEq(mine.minDifficulty(6), D);
        assertEq(mine.minDifficulty(100), D, "never below floor");
    }

    function test_minDifficulty_roundsUp() public {
        // 5 shares at D=6: work 320; ceilDiv(320, 4) = 80; ceil(log2(80)) = 7.
        _submit(alice, 6, 5);
        assertEq(mine.minDifficulty(2), 7);
    }

    function test_minDifficulty_storedOnActivation() public {
        _submit(alice, D, 64);
        _nextRound();
        _submit(bob, 8, 1);
        assertEq(mine.minDifficulty(2), 8);
        assertEq(mine.roundInfo(2).minDifficulty, 8);
    }
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `cd ~/Desktop/rig/contracts && forge test --match-contract HashMineTest`
Expected: FAIL компиляции — `Member "submit" not found`.

- [ ] **Step 4: Добавить в `HashMine.sol` секцию mutations (перед `// ---- views`) и приватные функции**

Вставить перед строкой `    // ------------------------------------------------------------------ views`:

```solidity
    // -------------------------------------------------------------- mutations

    /// @notice Submits `nonces` as shares of `difficulty` for `beneficiary` in the current round.
    /// @dev Anyone may send; work is credited to the beneficiary bound inside every hash.
    function submit(address beneficiary, uint256 round, uint8 difficulty, uint256[] calldata nonces) external {
        if (beneficiary == address(0)) revert ZeroAddress();
        uint256 current = currentRound();
        if (round != current) revert WrongRound(round, current);
        uint256 count = nonces.length;
        if (count == 0 || count > MAX_NONCES) revert BadNonceCount(count);
        uint8 minimum = minDifficulty(current);
        if (difficulty < minimum || difficulty > MAX_DIFFICULTY) revert BadDifficulty(difficulty, minimum);

        bytes32 roundChallenge = challenge(current);
        Miner storage miner = _miners[beneficiary];
        bool sameRound = miner.round == current;
        uint256 shift = 256 - uint256(difficulty);
        uint256 previous = miner.lastNonce;
        bytes32 shareHash;
        for (uint256 i; i < count; ++i) {
            uint256 nonce = nonces[i];
            if ((i != 0 || sameRound) && nonce <= previous) revert NonceNotIncreasing(i);
            shareHash = keccak256(abi.encodePacked(beneficiary, roundChallenge, nonce));
            if (uint256(shareHash) >> shift != 0) revert InvalidShare(i);
            previous = nonce;
        }
        uint192 work = SafeCast.toUint192(count << difficulty);

        if (lastActiveRound != current) _activate(current, roundChallenge, minimum);
        if (!sameRound) {
            _settle(miner);
            miner.round = uint64(current);
        }
        miner.lastNonce = previous;
        miner.work += work;

        Round storage info = _rounds[current];
        info.work += work;
        info.seed = shareHash;

        emit ShareBatch(beneficiary, current, difficulty, count, work, shareHash);
    }

```

Добавить в секцию `// ---- private` (после `_bits`):

```solidity
    function _activate(uint256 round, bytes32 roundChallenge, uint8 minimum) private {
        Round storage info = _rounds[round];
        info.challenge = roundChallenge;
        info.minDifficulty = minimum;
        lastActiveRound = round;
    }

    /// @dev Temporary: Task 5 replaces this with reward settlement.
    function _settle(Miner storage miner) private {
        miner.work = 0;
    }
```

- [ ] **Step 5: Прогнать тесты**

Run: `cd ~/Desktop/rig/contracts && forge test --match-contract HashMineTest -vv`
Expected: `22 passed; 0 failed`.

- [ ] **Step 6: Checkpoint** — `git status --short`: изменены `HashMine.sol`, `HashMine.t.sol`.

---

### Task 5: Закрытие раунда, расчёт, claim, pending

**Files:**
- Modify: `contracts/src/HashMine.sol`
- Modify: `contracts/test/HashMine.t.sol`

- [ ] **Step 1: Добавить в `HashMineTest` хелпер `_fund` (после `_nextRound`)**

```solidity
    function _fund(uint256 amount) internal {
        token.mint(address(mine), amount);
    }
```

- [ ] **Step 2: Добавить в конец `HashMineTest` падающие тесты наград**

```solidity
    // ---------------------------------------------------------------- rewards

    function test_rewardPool_countsDonations() public {
        _fund(1_000_000);
        assertEq(mine.rewardPool(), 1_000_000);
    }

    function test_close_splitsReleaseByWork() public {
        _fund(1_000_000);
        _submit(alice, D, 3);
        _submit(bob, D, 1);
        _nextRound();
        // release = 1_000_000 * 48 / 10_000 = 4_800; alice 3/4, bob 1/4.
        vm.expectEmit(address(mine));
        emit HashMine.RoundClosed(1, 4 << D, 4_800);
        _submit(alice, D, 1);

        assertEq(mine.reserved(), 4_800);
        assertTrue(mine.roundInfo(1).closed);
        assertEq(mine.claim(alice), 3_600);
        assertEq(mine.claim(bob), 1_200);
        assertEq(token.balanceOf(alice), 3_600);
        assertEq(token.balanceOf(bob), 1_200);
        assertEq(mine.reserved(), 0);
    }

    function test_claim_closesEndedRoundWithoutNewShares() public {
        _fund(1_000_000);
        _submit(alice, D, 1);
        _nextRound();
        vm.expectEmit(address(mine));
        emit HashMine.RoundClosed(1, 1 << D, 4_800);
        vm.expectEmit(address(mine));
        emit HashMine.Claimed(alice, 4_800);
        assertEq(mine.claim(alice), 4_800);
    }

    function test_claim_isPayableByAnyoneToBeneficiary() public {
        _fund(1_000_000);
        _submit(alice, D, 1);
        _nextRound();
        vm.prank(bob);
        mine.claim(alice);
        assertEq(token.balanceOf(alice), 4_800);
        assertEq(token.balanceOf(bob), 0);
    }

    function test_claim_doesNotPayRunningRound() public {
        _fund(1_000_000);
        _submit(alice, D, 1);
        assertEq(mine.claim(alice), 0);
        assertEq(token.balanceOf(alice), 0);
        assertFalse(mine.roundInfo(1).closed);
    }

    function test_claim_twiceDoesNotDoublePay() public {
        _fund(1_000_000);
        _submit(alice, D, 1);
        _nextRound();
        assertEq(mine.claim(alice), 4_800);
        assertEq(mine.claim(alice), 0);
    }

    function test_emptyRounds_releaseNothingAndDoNotCatchUp() public {
        _fund(1_000_000);
        _submit(alice, D, 1);
        vm.warp(mine.roundStart(10));
        _submit(bob, D, 1);
        assertEq(mine.reserved(), 4_800, "only round 1 released");
        vm.warp(mine.roundStart(11));
        assertEq(mine.claim(bob), (1_000_000 - 4_800) * 48 / 10_000);
    }

    function test_depositDuringRound_isIncludedAtClose() public {
        _submit(alice, D, 1);
        _fund(500_000);
        _nextRound();
        assertEq(mine.claim(alice), 2_400);
    }

    function test_roundWithEmptyPool_releasesZero() public {
        _submit(alice, D, 1);
        _nextRound();
        assertEq(mine.claim(alice), 0);
        assertTrue(mine.roundInfo(1).closed);
    }

    function test_pending_estimatesOpenRoundAndMatchesClosed() public {
        _fund(1_000_000);
        _submit(alice, D, 3);
        _submit(bob, D, 1);
        assertEq(mine.pending(alice), 3_600, "open round estimate");
        _nextRound();
        _submit(bob, D, 1);
        assertEq(mine.pending(alice), 3_600, "closed round exact");
        assertEq(mine.pending(bob), 1_200 + (1_000_000 - 4_800) * 48 / 10_000);
    }

    function testFuzz_payoutsProportionalToWork(uint8 aShares, uint8 bShares, uint8 aDifficulty, uint96 pool)
        public
    {
        uint256 sharesA = bound(aShares, 1, 16);
        uint256 sharesB = bound(bShares, 1, 16);
        uint8 difficultyA = uint8(bound(aDifficulty, D, 7));
        uint256 amount = bound(pool, 1e18, 1e27);
        _fund(amount);
        _submit(alice, difficultyA, sharesA);
        _submit(bob, D, sharesB);
        _nextRound();

        uint256 release = amount * 48 / 10_000;
        uint256 workA = sharesA << difficultyA;
        uint256 workB = sharesB << D;
        uint256 paidA = mine.claim(alice);
        uint256 paidB = mine.claim(bob);
        assertApproxEqAbs(paidA, release * workA / (workA + workB), 1);
        assertApproxEqAbs(paidB, release * workB / (workA + workB), 1);
        assertLe(paidA + paidB, release);
    }
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `cd ~/Desktop/rig/contracts && forge test --match-contract HashMineTest`
Expected: FAIL компиляции — `Member "rewardPool" not found`.

- [ ] **Step 4: Добавить `claim` в секцию mutations (после `submit`)**

```solidity
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
```

- [ ] **Step 5: Добавить `rewardPool` и `pending` в секцию views (после `roundStart`)**

```solidity
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
```

- [ ] **Step 6: Заменить `_activate` и временный `_settle`, добавить `_close`**

Заменить функции `_activate` и `_settle` целиком на:

```solidity
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
```

- [ ] **Step 7: Прогнать тесты**

Run: `cd ~/Desktop/rig/contracts && forge test --match-contract HashMineTest -vv`
Expected: `33 passed; 0 failed` (fuzz-тест — 256 прогонов).

- [ ] **Step 8: Checkpoint** — `git status --short`.

---

### Task 6: Инварианты

**Files:**
- Create: `contracts/test/HashMineInvariant.t.sol`

- [ ] **Step 1: Записать `contracts/test/HashMineInvariant.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HashMine} from "../src/HashMine.sol";
import {MockERC20} from "./utils/MockERC20.sol";
import {ShareFinder} from "./utils/ShareFinder.sol";

contract HashMineHandler is Test {
    uint8 internal constant MAX_TEST_DIFFICULTY = 6;

    HashMine public immutable mine;
    MockERC20 public immutable token;
    address[] internal _actors;
    uint256 public funded;
    uint256 public claimed;

    constructor(HashMine mine_, MockERC20 token_) {
        mine = mine_;
        token = token_;
        _actors.push(makeAddr("miner0"));
        _actors.push(makeAddr("miner1"));
        _actors.push(makeAddr("miner2"));
    }

    function actors() external view returns (address[] memory) {
        return _actors;
    }

    function fund(uint256 amount) external {
        amount = bound(amount, 0, 1e24);
        token.mint(address(mine), amount);
        funded += amount;
    }

    function submit(uint256 actorSeed, uint256 count, uint256 extraBits) external {
        address who = _actors[actorSeed % _actors.length];
        uint256 round = mine.currentRound();
        uint256 difficulty = uint256(mine.minDifficulty(round)) + (extraBits % 2);
        if (difficulty > MAX_TEST_DIFFICULTY) return;
        count = bound(count, 1, 4);
        HashMine.Miner memory m = mine.minerState(who);
        uint256 from = m.round == round ? m.lastNonce : 0;
        uint256[] memory nonces = ShareFinder.find(who, mine.challenge(round), uint8(difficulty), from, count);
        mine.submit(who, round, uint8(difficulty), nonces);
    }

    function warp(uint256 secondsForward) external {
        vm.warp(block.timestamp + bound(secondsForward, 1, 1_800));
    }

    function claim(uint256 actorSeed) external {
        claimed += mine.claim(_actors[actorSeed % _actors.length]);
    }
}

contract HashMineInvariantTest is Test {
    MockERC20 internal token;
    HashMine internal mine;
    HashMineHandler internal handler;

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockERC20();
        mine = new HashMine(
            IERC20(address(token)),
            HashMine.Params({roundLength: 600, releaseBps: 48, targetShares: 256, minDifficulty: 2})
        );
        handler = new HashMineHandler(mine, token);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = HashMineHandler.fund.selector;
        selectors[1] = HashMineHandler.submit.selector;
        selectors[2] = HashMineHandler.warp.selector;
        selectors[3] = HashMineHandler.claim.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_tokensAreConserved() public view {
        assertEq(token.balanceOf(address(mine)) + handler.claimed(), handler.funded());
    }

    function invariant_reservedIsBacked() public view {
        assertGe(token.balanceOf(address(mine)), mine.reserved());
    }

    function invariant_owedToMinersWithinReserved() public view {
        address[] memory actors = handler.actors();
        uint256 owed;
        for (uint256 i; i < actors.length; ++i) {
            HashMine.Miner memory m = mine.minerState(actors[i]);
            owed += m.claimable;
            HashMine.Round memory info = mine.roundInfo(m.round);
            if (m.work != 0 && info.closed) owed += Math.mulDiv(m.work, info.rewardPerWork, 1e36);
        }
        assertLe(owed, mine.reserved());
    }
}
```

- [ ] **Step 2: Прогнать инварианты**

Run: `cd ~/Desktop/rig/contracts && forge test --match-contract HashMineInvariantTest -vv`
Expected: `3 passed; 0 failed`, в выводе `runs: 64, calls: 4096` для каждого инварианта и ненулевое число вызовов `submit` и `claim` в таблице handler-вызовов.

- [ ] **Step 3: Checkpoint** — `git status --short`.

---

### Task 7: Замер газа

**Files:**
- Create: `contracts/test/HashMineGas.t.sol`

- [ ] **Step 1: Записать `contracts/test/HashMineGas.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HashMine} from "../src/HashMine.sol";
import {MockERC20} from "./utils/MockERC20.sol";
import {ShareFinder} from "./utils/ShareFinder.sol";

/// @notice Execution gas of submit/claim, without intrinsic calldata cost. Numbers go to the plan report.
contract HashMineGasTest is Test {
    uint8 internal constant D = 4;
    MockERC20 internal token;
    HashMine internal mine;

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockERC20();
        mine = new HashMine(
            IERC20(address(token)), HashMine.Params({roundLength: 600, releaseBps: 48, targetShares: 4, minDifficulty: D})
        );
        token.mint(address(mine), 1e27);
    }

    function _measureSubmit(address who, uint256 count) internal returns (uint256 used) {
        uint256 round = mine.currentRound();
        HashMine.Miner memory m = mine.minerState(who);
        uint256 from = m.round == round ? m.lastNonce : 0;
        uint8 difficulty = mine.minDifficulty(round);
        uint256[] memory nonces = ShareFinder.find(who, mine.challenge(round), difficulty, from, count);
        uint256 before = gasleft();
        mine.submit(who, round, difficulty, nonces);
        used = before - gasleft();
    }

    function test_gas_report() public {
        address a = makeAddr("a");
        address b = makeAddr("b");
        address c = makeAddr("c");

        emit log_named_uint("submit 1 share, first share ever (activates round 1)", _measureSubmit(a, 1));
        emit log_named_uint("submit 1 share, new miner, active round", _measureSubmit(b, 1));
        emit log_named_uint("submit 16 shares, same miner, same round", _measureSubmit(b, 16));
        emit log_named_uint("submit 64 shares, new miner, active round", _measureSubmit(c, 64));

        vm.warp(mine.roundStart(2));
        emit log_named_uint("submit 1 share, closes round 1 + settles miner", _measureSubmit(a, 1));

        vm.warp(mine.roundStart(3));
        uint256 before = gasleft();
        mine.claim(b);
        emit log_named_uint("claim (settle closed round + transfer)", before - gasleft());
    }
}
```

- [ ] **Step 2: Прогнать и записать цифры**

Run: `cd ~/Desktop/rig/contracts && forge test --match-contract HashMineGasTest -vv`
Expected: `1 passed`, шесть строк с газом. Цифры внести в отчёт по плану. Ориентир — `submit` на 64 шары ≤ 150 000 газа исполнения. Если больше, это сигнал для оптимизации хэширования в assembly отдельной задачей, а не повод молча переписывать.

- [ ] **Step 3: Полный прогон**

Run: `cd ~/Desktop/rig/contracts && forge test`
Expected: все сьюты зелёные: `HashMineTest` 33, `HashMineInvariantTest` 3, `HashMineGasTest` 1.

- [ ] **Step 4: Checkpoint** — `git status --short`.

---

## Self-Review (выполнен при написании)

- **Покрытие спеки §5:** параметры (Task 3); раунды, челлендж и якорь (Task 3–4); шара, заявленная сложность, минимальная сложность с затуханием (Task 4); submit со всеми проверками и эффектами (Task 4); закрытие, выпуск без догоняния, расчёт, claim без оплаты идущего раунда (Task 5); view `rewardPool`, `pending`, `minerState`, `roundWork` (Task 3, 5); инварианты §7 п.2 (Task 5 fuzz, Task 6); газ-снапшоты §7 п.3 для `submit` и `claim` (Task 7). `harvest` и форк — план 02.
- **Отклонение от спеки:** параметры передаются в конструктор (immutable), а не зашиты константами. Спека §5.1 обновлена.
- **Согласованность имён:** `Params{roundLength, releaseBps, targetShares, minDifficulty}`, `Miner{round, work, lastNonce, claimable}`, `Round{challenge, seed, work, minDifficulty, closed, rewardPerWork}`, ошибки и события одинаковы в контракте и тестах.

---

## Отклонения при исполнении (2026-09-14)

1. **Task 1, OpenZeppelin.** `forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --shallow` падает с `Tag "v5.1.0" not found`. Работает без `--shallow`. Полузарегистрированный подмодуль перед повтором удаляется: `git rm --cached`, секция в `.gitmodules`, `.git/modules/...`. Итог: `v5.1.0@69c8def5`, записан в `contracts/foundry.lock`.
2. **Task 4, `submit`.** Код из шага 4 не компилируется: `Stack too deep`. `submit` разбит на три функции: `submit` (проверки раунда, количества, сложности), `_verifyShares(beneficiary, roundChallenge, difficulty, nonces, hasPrevious, previousNonce)` (порядок nonce и валидность хэшей; pure) и `_record(beneficiary, miner, round, sameRound, difficulty, count, lastNonce, lastHash)` (зачёт работы и событие). Поведение и ошибки те же; `via-ir` не включался.
3. **Task 5, тесты.** Выражение `(1_000_000 - 4_800) * 48 / 10_000` в Solidity — литеральное рациональное (4776.96) и не компилируется. Заменено хелпером `_release(uint256 pool)` с целочисленным делением. В `test_close_splitsReleaseByWork` nonce ищутся до `vm.expectEmit`, затем идёт прямой `mine.submit`: view-вызовы внутри `_submit` не должны стоять между `expectEmit` и проверяемым вызовом.
4. **Task 4, размещение хелперов.** `_find`, `_submit`, `_one`, `_nextRound` лежат в секции `helpers` перед тестами submit, а не сразу после `_params()`. На поведение не влияет.
