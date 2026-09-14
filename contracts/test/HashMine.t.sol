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

    // ---------------------------------------------------------------- helpers

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

    // ---------------------------------------------------------------- rewards

    function _fund(uint256 amount) internal {
        token.mint(address(mine), amount);
    }

    /// @dev Release of one round for a given pool, with the contract's integer rounding.
    function _release(uint256 pool) internal pure returns (uint256) {
        return pool * 48 / 10_000;
    }

    function test_rewardPool_countsDonations() public {
        _fund(1_000_000);
        assertEq(mine.rewardPool(), 1_000_000);
    }

    function test_close_splitsReleaseByWork() public {
        _fund(1_000_000);
        _submit(alice, D, 3);
        _submit(bob, D, 1);
        _nextRound();
        uint256[] memory nonces = _find(alice, D, 1);
        // release = 1_000_000 * 48 / 10_000 = 4_800; alice 3/4, bob 1/4.
        vm.expectEmit(address(mine));
        emit HashMine.RoundClosed(1, 4 << D, 4_800);
        mine.submit(alice, 2, D, nonces);

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
        mine.claim(alice);
        assertEq(token.balanceOf(alice), 4_800);
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
        assertEq(mine.claim(bob), _release(1_000_000 - 4_800));
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
        assertEq(mine.pending(bob), 1_200 + _release(1_000_000 - 4_800));
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

        uint256 release = _release(amount);
        uint256 workA = sharesA << difficultyA;
        uint256 workB = sharesB << D;
        uint256 paidA = mine.claim(alice);
        uint256 paidB = mine.claim(bob);
        assertApproxEqAbs(paidA, release * workA / (workA + workB), 1);
        assertApproxEqAbs(paidB, release * workB / (workA + workB), 1);
        assertLe(paidA + paidB, release);
    }
}
