import { polygonWeb3 as web3 } from '../../../utils/web3';
import { POLYGON_CHAIN_ID as chainId, SUSHI_LPF } from '../../../constants';

import { getMiniChefApys } from '../common/getMiniChefApys';
// import { sushiPolyClient } from '../../../apollo/client';

import pools from '../../../data/matic/quickGammaLpPools.json';
import SushiMiniChefV2 from '../../../abis/matic/SushiMiniChefV2.json';

import { addressBook } from '../../../../packages/address-book/address-book';
const {
  polygon: {
    platforms: {
      quickswap: { minichef },
    },
  },
} = addressBook;

export const getQuickGammaApys = () => {
  return getMiniChefApys({
    minichefConfig: {
      minichef,
      minichefAbi: SushiMiniChefV2,
      outputOracleId: 'dQUICK',
      tokenPerSecondContractMethodName: 'sushiPerSecond',
    },
    rewarderConfig: {
      rewarder: '0x158B99aE660D4511e4c52799e1c47613cA47a78a',
      rewarderTokenOracleId: 'dQUICK',
    },
    pools,
    quickGamma: 'https://wire2.gamma.xyz/quickswap/polygon/hypervisors/allData',
    web3: web3,
    chainId: chainId,
  });
};
