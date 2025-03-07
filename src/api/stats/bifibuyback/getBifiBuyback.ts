import { BlockApiResponse, ERC20TxApiResponse } from './explorerApiResponseTypes';

import BigNumber from 'bignumber.js';
import fetch from 'node-fetch';
import { addressBook } from '../../../../packages/address-book/address-book';

import fetchPrice from '../../../utils/fetchPrice';
import { getUtcSecondsFromDayRange } from '../../../utils/getUtcSecondsFromDayRange';
import { getEDecimals } from '../../../utils/getEDecimals';
import { explorerApiUrlMap } from './explorerApiUrlMap';
import { bifiLpMap } from './bifiLpMap';
import { getKey, setKey } from '../../../utils/cache';

const INIT_DELAY = 40 * 1000;
const REFRESH_INTERVAL = 15 * 60 * 1000;

export interface DailyBifiBuybackStats {
  buybackTokenAmount: BigNumber;
  buybackUsdAmount: BigNumber;
}

const getStartBlockFromExplorer = async (scanUrl: string, apiToken: string) => {
  const [start, end] = getUtcSecondsFromDayRange(0, 1);
  return await getBlockFromExplorer(scanUrl, start, apiToken);
};

const getBlockFromExplorer = async (scanUrl: string, timestamp: number, apiToken?: string) => {
  const url =
    `${scanUrl}/api?module=block&action=getblocknobytime&timestamp=${timestamp}&closest=after` +
    (apiToken ? `&apikey=${apiToken}` : '');
  try {
    const resp = await fetch(url);
    const json: BlockApiResponse = await resp.json();
    return typeof json.result === 'object' ? json.result.blockNumber : json.result;
  } catch (e) {
    console.error(`> bifi buyback block fetch error on ${scanUrl}`, e);
    return 0;
  }
};

const getBuyback = async (
  chainName: string,
  scanUrl: string,
  apiToken: string,
  BIFI: any, // TODO type this with brknrobot's address book types, once merged
  bifiMaxiAddress: string,
  bifiLpAddress: string
): Promise<{ [key: string]: BigNumber }> => {
  let bifiBuybackTokenAmount = new BigNumber(0);
  try {
    const startBlock = await getStartBlockFromExplorer(scanUrl, apiToken);
    const url =
      `${scanUrl}/api?module=account&action=tokentx&address=${bifiMaxiAddress}&sort=asc&start` +
      (apiToken === undefined && chainName !== 'kava' ? '_' : '') +
      `block=${startBlock}` +
      (apiToken ? `&apikey=${apiToken}` : '');
    const resp = await fetch(url);
    const json: ERC20TxApiResponse = await resp.json();
    let txCount = 0;
    for (const entry of json.result) {
      // actually should use the lp pool data here instead of address-book. Will change after converging address-book and api
      if (entry.from === bifiLpAddress.toLowerCase()) {
        const tokenAmount = new BigNumber(entry.value).dividedBy(getEDecimals(BIFI.decimals));
        bifiBuybackTokenAmount = bifiBuybackTokenAmount.plus(tokenAmount);
        txCount += 1;
      }
    }
  } catch (e) {
    console.error(`> bifi buyback fetch error on ${chainName}`, e);
  }
  // console.log(`Harvest count: ${txCount}`);
  return { [chainName]: bifiBuybackTokenAmount };
};

let dailyBifiBuybackStats: DailyBifiBuybackStats | undefined = undefined;

const updateBifiBuyback = async () => {
  console.log('> updating bifi buyback');

  try {
    let promises = [];

    const chainNames = Object.keys(explorerApiUrlMap);

    chainNames.forEach(chainName => {
      const { url, apiToken } = explorerApiUrlMap[chainName];
      const lp = bifiLpMap[chainName];
      const chainAddressBook = addressBook[chainName];
      const chainBIFI = chainAddressBook.tokens.BIFI;
      const chainBifiMaxi = chainAddressBook.platforms.beefyfinance.bifiMaxiStrategy;
      const prom = getBuyback(chainName, url, apiToken, chainBIFI, chainBifiMaxi, lp);
      promises.push(prom);
    });

    const bifiPrice = await fetchPrice({ oracle: 'tokens', id: 'BIFI' });

    const results = await Promise.allSettled<{ [key: string]: BigNumber }[]>(promises);
    let dailyBifiBuybackAmountByChain: { [key: string]: BigNumber } = {};
    for (const result of results) {
      if (result.status !== 'fulfilled') {
        console.warn('getBifiBuyback error', result.reason);
        continue;
      }

      dailyBifiBuybackAmountByChain = { ...dailyBifiBuybackAmountByChain, ...result.value };
    }

    for (const key in dailyBifiBuybackAmountByChain) {
      const buybackTokenAmount = dailyBifiBuybackAmountByChain[key];
      const buybackUsdAmount = buybackTokenAmount.times(new BigNumber(bifiPrice));
      dailyBifiBuybackStats = {
        ...dailyBifiBuybackStats,
        [key]: {
          buybackTokenAmount,
          buybackUsdAmount,
        },
      };
    }

    console.log('> updated bifi buyback');
    saveToRedis();
  } catch (err) {
    console.error('> bifi buyback initialization failed', err);
  }

  setTimeout(updateBifiBuyback, REFRESH_INTERVAL);
};

export const initBifiBuyBackService = async () => {
  const cachedDailyBifiBuyBack = await getKey<DailyBifiBuybackStats>('DAILY_BUYBACK');
  dailyBifiBuybackStats = cachedDailyBifiBuyBack ?? undefined;

  setTimeout(updateBifiBuyback, INIT_DELAY);
};

const saveToRedis = async () => {
  await setKey('DAILY_BUYBACK', dailyBifiBuybackStats);
};

export const getBifiBuyback = (): DailyBifiBuybackStats | undefined => {
  return dailyBifiBuybackStats;
};
