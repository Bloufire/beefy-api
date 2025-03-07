const getSolidlyStablePrices = require('../common/getSolidlyStablePrices');
const { arbitrumWeb3: web3 } = require('../../../utils/web3');
const pools = require('../../../data/arbitrum/solidlizardStableLpPools.json');

const getSolidLizardStablePrices = async tokenPrices => {
  return await getSolidlyStablePrices(web3, pools, tokenPrices);
};

module.exports = getSolidLizardStablePrices;
