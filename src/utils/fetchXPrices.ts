import BigNumber from 'bignumber.js';
import { MultiCall } from 'eth-multicall';
import { web3Factory, multicallAddress } from './web3';
import ERC20 from '../abis/ERC20.json';

import {
  FANTOM_CHAIN_ID,
  FUSE_CHAIN_ID,
  POLYGON_CHAIN_ID,
  MOONBEAM_CHAIN_ID,
  AURORA_CHAIN_ID,
} from '../constants';
import { addressBook } from '../../packages/address-book/address-book';
import { getContract } from './contractHelper';

const {
  fantom: {
    tokens: { BOO, xBOO, SCREAM, xSCREAM, CREDIT, xCREDIT },
  },
  polygon: {
    tokens: { newQUICK, newdQUICK },
  },
  fuse: {
    tokens: { VOLT, xVOLT },
  },
  moonbeam: {
    tokens: { STELLA, xSTELLA },
  },
  aurora: {
    tokens: { TRI, xTRI },
  },
} = addressBook;

const tokens = {
  fantom: [
    [BOO, xBOO],
    [SCREAM, xSCREAM],
    [CREDIT, xCREDIT],
  ],
  polygon: [[newQUICK, newdQUICK]],
  fuse: [[VOLT, xVOLT]],
  moonbeam: [[STELLA, xSTELLA]],
  aurora: [[TRI, xTRI]],
};

const getXPrices = async (tokenPrices, tokens, chainId) => {
  const web3 = web3Factory(chainId);
  const multicall = new MultiCall(web3, multicallAddress(chainId));

  const stakedInXPoolCalls = [];
  const totalXSupplyCalls = [];

  tokens.forEach(token => {
    const tokenContract = getContract(ERC20, token[0].address);
    const xTokenContract = getContract(ERC20, token[1].address);
    stakedInXPoolCalls.push({
      stakedInXPool: tokenContract.methods.balanceOf(token[1].address),
    });
    totalXSupplyCalls.push({
      totalXSupply: xTokenContract.methods.totalSupply(),
    });
  });

  let res;
  try {
    res = await multicall.all([stakedInXPoolCalls, totalXSupplyCalls]);
  } catch (e) {
    console.error('getXPrices', e);
    return tokens.map(() => 0);
  }
  const stakedInXPool = res[0].map(v => new BigNumber(v.stakedInXPool));
  const totalXSupply = res[1].map(v => new BigNumber(v.totalXSupply));

  return stakedInXPool.map((v, i) =>
    v.times(tokenPrices[tokens[i][0].symbol]).dividedBy(totalXSupply[i]).toNumber()
  );
};

export async function fetchXPrices(
  tokenPrices: Record<string, number>
): Promise<Record<string, number>> {
  return Promise.all([
    getXPrices(tokenPrices, tokens.fantom, FANTOM_CHAIN_ID),
    getXPrices(tokenPrices, tokens.polygon, POLYGON_CHAIN_ID),
    getXPrices(tokenPrices, tokens.fuse, FUSE_CHAIN_ID),
    getXPrices(tokenPrices, tokens.moonbeam, MOONBEAM_CHAIN_ID),
    getXPrices(tokenPrices, tokens.aurora, AURORA_CHAIN_ID),
  ]).then(data =>
    data
      .flat()
      .reduce((acc, cur, i) => ((acc[Object.values(tokens).flat()[i][1].symbol] = cur), acc), {})
  );
}
