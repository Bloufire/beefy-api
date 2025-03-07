import BigNumber from 'bignumber.js';
import Web3 from 'web3';
import { MultiCall, ShapeWithLabel } from 'eth-multicall';
import { multicallAddress } from '../../../utils/web3';
import { ChainId } from '../../../../packages/address-book/types/chainid';

import fetchPrice from '../../../utils/fetchPrice';
import { getApyBreakdown } from './getApyBreakdown';
import { LpPool, SingleAssetPool } from '../../../types/LpPool';
import fetch from 'node-fetch';

// trading apr
import { SUSHI_LPF } from '../../../constants';
import {
  getTradingFeeAprSushi,
  getTradingFeeApr,
  getTradingFeeAprSushiTrident,
} from '../../../utils/getTradingFeeApr';
import { isSushiClient, isSushiTridentClient } from '../../../apollo/client';
import { NormalizedCacheObject } from '@apollo/client/core';
import { ApolloClient } from '@apollo/client/core';

// abis
import SushiComplexRewarderTime from '../../../abis/matic/SushiComplexRewarderTime.json';
import ERC20 from '../../../abis/ERC20.json';
import { Contract } from 'web3-eth-contract';
import { AbiItem } from 'web3-utils';
import { getContract, getContractWithProvider } from '../../../utils/contractHelper';

const oracle = 'tokens';
const DECIMALS = '1e18';
const secondsPerBlock = 1;
const secondsPerYear = 31536000;

interface MiniChefApyParams {
  minichefConfig: {
    minichef: string; // address
    minichefAbi: AbiItem[];
    outputOracleId: string; // i.e. SUSHI
    tokenPerSecondContractMethodName: `${string}PerSecond`;
  };
  rewarderConfig?: {
    // TODO: get this info from minichef rather than hardcoding it
    rewarder: string; // address
    rewarderTokenOracleId: string; // i.e. WMATIC
    // totalAllocPoint is non public
    // https://github.com/sushiswap/sushiswap/blob/37026f3749f9dcdae89891f168d63667845576a7/contracts/mocks/ComplexRewarderTime.sol#L44
    // need to pass in same hardcoded value found here:
    // https://github.com/sushiswap/sushiswap-interface/blob/6300093e17756038a5b5089282d7bbe6dce87759/src/hooks/minichefv2/useFarms.ts#L77
    rewarderTotalAllocPoint?: number;
  };
  pools: (LpPool | SingleAssetPool)[];
  tradingClient?: ApolloClient<NormalizedCacheObject>;
  quickGamma?: string;
  sushiClient?: boolean;
  liquidityProviderFee?: number;
  web3: Web3;
  chainId: ChainId;
  log?: boolean;
}

export const getMiniChefApys = async (params: MiniChefApyParams) => {
  const { pools, tradingClient, sushiClient, liquidityProviderFee } = params;
  const pairAddresses = pools.map(pool => pool.address);
  let tradingAprs: Record<string, BigNumber> | undefined;
  let fee: number | undefined;
  if (tradingClient !== undefined) {
    fee = liquidityProviderFee !== undefined ? liquidityProviderFee : SUSHI_LPF;
    tradingAprs = (await isSushiClient(tradingClient))
      ? await getTradingFeeAprSushi(tradingClient, pairAddresses, fee)
      : (await isSushiTridentClient(tradingClient))
      ? await getTradingFeeAprSushiTrident(tradingClient, pairAddresses, fee)
      : await getTradingFeeApr(tradingClient, pairAddresses, fee);
  } else if (params.quickGamma) {
    try {
      tradingAprs = {};
      const response = await fetch(params.quickGamma).then(res => res.json());
      pools.forEach(p => {
        tradingAprs[p.address.toLowerCase()] = new BigNumber(
          response[p.address.toLowerCase()].returns.daily.feeApr
        );
      });
    } catch (e) {
      console.error(`Error getting gamma trading aprs`, e);
      tradingAprs = {};
    }
  } else {
    tradingAprs = {};
  }
  const farmApys = await getFarmApys(params);

  return getApyBreakdown(pools, tradingAprs, farmApys, fee);
};

const getFarmApys = async (params: MiniChefApyParams) => {
  const { web3, pools, minichefConfig, rewarderConfig } = params;
  const apys = [];

  // minichef
  const minichefContract = getContractWithProvider(
    minichefConfig.minichefAbi as any,
    minichefConfig.minichef,
    web3
  );
  const miniChefTokenPerSecond = new BigNumber(
    await minichefContract.methods[minichefConfig.tokenPerSecondContractMethodName]().call()
  );
  const miniChefTotalAllocPoint = new BigNumber(
    await minichefContract.methods.totalAllocPoint().call()
  );
  const miniChefTokenPrice = await fetchPrice({ oracle, id: minichefConfig.outputOracleId });

  // rewarder, if rewarder is set
  let rewarderContract: Contract | undefined = undefined;
  let rewarderTokenPerSecond: BigNumber | undefined;
  let rewarderTokenPrice: number | undefined;
  let rewarderTotalAllocPoint: number | undefined;

  if (rewarderConfig) {
    rewarderContract = getContractWithProvider(
      SushiComplexRewarderTime as any,
      rewarderConfig.rewarder,
      web3
    );
    rewarderTokenPerSecond = new BigNumber(await rewarderContract.methods.rewardPerSecond().call());

    if (rewarderConfig.rewarderTotalAllocPoint == undefined) {
      rewarderTotalAllocPoint = new BigNumber(
        await rewarderContract.methods.totalAllocPoint().call()
      ).toNumber();
    } else {
      rewarderTotalAllocPoint = rewarderConfig.rewarderTotalAllocPoint;
    }

    rewarderTokenPrice = await fetchPrice({
      oracle,
      id: rewarderConfig.rewarderTokenOracleId,
    });
  }

  const { balances, allocPoints, rewardAllocPoints } = await getPoolsData(params);

  // get apy for each pool
  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];

    const lpPrice = await fetchPrice({ oracle: 'lps', id: pool.name });
    const totalStakedInUsd = balances[i].times(lpPrice).dividedBy('1e18');

    let totalYearlyRewardsInUsd: BigNumber = new BigNumber(0);

    // MiniChef rewards
    const miniChefPoolBlockRewards = miniChefTokenPerSecond
      .times(allocPoints[i])
      .dividedBy(miniChefTotalAllocPoint);
    const miniChefYearlyRewards = miniChefPoolBlockRewards
      .dividedBy(secondsPerBlock)
      .times(secondsPerYear);
    const miniChefYearlyRewardsInUsd = miniChefYearlyRewards
      .times(miniChefTokenPrice)
      .dividedBy(DECIMALS);
    totalYearlyRewardsInUsd = totalYearlyRewardsInUsd.plus(miniChefYearlyRewardsInUsd);

    // Rewarder rewards, if rewarder is set
    if (rewarderConfig) {
      const allocPoint = rewardAllocPoints[i];
      const nativeRewards = rewarderTokenPerSecond
        .times(allocPoint)
        .dividedBy(rewarderTotalAllocPoint);
      const yearlyNativeRewards = nativeRewards.dividedBy(secondsPerBlock).times(secondsPerYear);
      const nativeRewardsInUsd = yearlyNativeRewards.times(rewarderTokenPrice).dividedBy(DECIMALS);
      totalYearlyRewardsInUsd = totalYearlyRewardsInUsd.plus(nativeRewardsInUsd);
    }

    if (pool.extraRewards) {
      let extraRewards: BigNumber = new BigNumber(0);
      for (const rewards of pool.extraRewards ?? []) {
        let rewardContract = getContractWithProvider(
          SushiComplexRewarderTime as any,
          rewards.rewarder,
          web3
        );

        const totalAllocPoint = new BigNumber(
          await rewardContract.methods.totalAllocPoint().call()
        );
        const poolInfo = await rewardContract.methods.poolInfo(pool.poolId).call();
        const allocPoint = new BigNumber(poolInfo['2']);

        const rewardPerSecond = new BigNumber(
          await rewardContract.methods.rewardPerSecond().call()
        );

        const price = await fetchPrice({ oracle: 'tokens', id: rewards.oracleId });
        const reward = rewardPerSecond.times(allocPoint).dividedBy(totalAllocPoint);
        const rewardsPerYear = reward.dividedBy(secondsPerBlock).times(secondsPerYear);
        extraRewards = extraRewards.plus(rewardsPerYear.times(price).dividedBy(rewards.decimals));
      }
      totalYearlyRewardsInUsd = totalYearlyRewardsInUsd.plus(extraRewards);
    }

    const apy = totalYearlyRewardsInUsd.dividedBy(totalStakedInUsd);
    if (params.log) {
      console.log(
        pool.name,
        apy.toNumber(),
        totalStakedInUsd.valueOf(),
        totalYearlyRewardsInUsd.valueOf()
      );
    }
    apys.push(apy);
  }
  return apys;
};

const getPoolsData = async (params: MiniChefApyParams) => {
  const { web3, pools, minichefConfig, rewarderConfig, chainId } = params;

  const minichefContract = getContract(minichefConfig.minichefAbi as any, minichefConfig.minichef);

  // rewarder, if rewarder is set
  let rewarderContract: Contract | undefined = undefined;
  if (rewarderConfig) {
    rewarderContract = getContract(SushiComplexRewarderTime as any, rewarderConfig.rewarder);
  }

  const balanceCalls = [];
  const allocPointCalls = [];
  const rewardAllocPointCalls = [];

  pools.forEach(pool => {
    const tokenContract = getContract(ERC20 as any, pool.address);
    balanceCalls.push({
      balance: tokenContract.methods.balanceOf(minichefConfig.minichef),
    });
    allocPointCalls.push({
      allocPoint: minichefContract.methods.poolInfo(pool.poolId),
    });

    // rewarder, if rewarder is set
    if (rewarderConfig && rewarderContract) {
      rewardAllocPointCalls.push({
        allocPoint: rewarderContract.methods.poolInfo(pool.poolId),
      });
    }
  });

  const multicall = new MultiCall(web3 as any, multicallAddress(chainId));
  const multicallParams: ShapeWithLabel[][] = [balanceCalls, allocPointCalls];

  // rewarder, if rewarder is set
  if (rewarderConfig) {
    multicallParams.push(rewardAllocPointCalls);
  }

  const res = await multicall.all(multicallParams);

  const balances = res[0].map(v => new BigNumber(v.balance));
  const allocPoints = res[1].map(v => v.allocPoint['2']);
  const rewardAllocPoints = rewarderConfig ? res[2].map(v => v.allocPoint['2']) : {};
  return { balances, allocPoints, rewardAllocPoints };
};
