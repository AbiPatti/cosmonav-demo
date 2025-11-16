const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

module.exports = ({ config }) => {
  return {
    ...config,
    extra: {
      ...config.extra,
      ORS_API_KEY: process.env.ORS_API_KEY || '',
    },
  };
};
