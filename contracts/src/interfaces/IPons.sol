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
