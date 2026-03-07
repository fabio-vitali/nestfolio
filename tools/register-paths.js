const { register } = require('tsconfig-paths');
const { join } = require('path');

const baseUrl = join(__dirname, '..');
const tsConfig = require(join(baseUrl, 'tsconfig.base.json'));

register({
  baseUrl,
  paths: tsConfig.compilerOptions.paths,
});
