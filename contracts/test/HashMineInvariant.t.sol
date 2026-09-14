// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HashMine} from "../src/HashMine.sol";
import {ShareFinder} from "./utils/ShareFinder.sol";

contract HashMineHandler is Test {
    uint8 internal constant MAX_TEST_DIFFICULTY = 6;

    HashMine public immutable mine;
    address[] internal _actors;
    uint256 public funded;
    uint256 public claimed;

    constructor(HashMine mine_) {
        mine = mine_;
        _actors.push(makeAddr("miner0"));
        _actors.push(makeAddr("miner1"));
        _actors.push(makeAddr("miner2"));
    }

    function actors() external view returns (address[] memory) {
        return _actors;
    }

    function fund(uint256 amount) external {
        amount = bound(amount, 0, 1e24);
        vm.deal(address(this), amount);
        (bool ok,) = address(mine).call{value: amount}("");
        require(ok, "fund");
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
    HashMine internal mine;
    HashMineHandler internal handler;

    function setUp() public {
        vm.warp(1_000_000);
        mine = new HashMine(HashMine.Params({roundLength: 600, releaseBps: 48, targetShares: 256, minDifficulty: 2}));
        handler = new HashMineHandler(mine);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = HashMineHandler.fund.selector;
        selectors[1] = HashMineHandler.submit.selector;
        selectors[2] = HashMineHandler.warp.selector;
        selectors[3] = HashMineHandler.claim.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_ethIsConserved() public view {
        assertEq(address(mine).balance + handler.claimed(), handler.funded());
    }

    function invariant_reservedIsBacked() public view {
        assertGe(address(mine).balance, mine.reserved());
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
