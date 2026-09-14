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
