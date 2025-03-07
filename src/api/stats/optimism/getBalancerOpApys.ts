import { optimismWeb3 as web3 } from '../../../utils/web3';
import { OPTIMISM_CHAIN_ID as chainId } from '../../../constants';
import { beetOpClient as client } from '../../../apollo/client';
const { getBalancerApys } = require('../common/getBalancerApys');
import { addressBook } from '../../../../packages/address-book/address-book';

const {
  optimism: {
    platforms: { beethovenX },
  },
} = addressBook;

const pools = require('../../../data/optimism/balancerOpLpPools.json');

const aaveDataProvider = '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654';

const getBalancerOpApys = async () => {
  return getBalancerApys({
    web3: web3,
    chainId: chainId,
    client: client,
    pools: pools,
    balancerVault: beethovenX.router,
    aaveDataProvider: aaveDataProvider,
    // log: true,
  });
};

module.exports = getBalancerOpApys;
