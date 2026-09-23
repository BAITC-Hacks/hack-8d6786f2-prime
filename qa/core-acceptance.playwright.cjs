const path = require('node:path')
const base = require('./playwright.config.cjs')
module.exports = {
  ...base,
  testDir: path.resolve(__dirname, '../frontend/tests'),
  testMatch: 'acceptance-clarity.spec.cjs',
}
