module.exports = {
  networks: {
  },
  mocha: {
    timeout: 100000
  },
  compilers: {
    solc: {
      version: "0.5.6",
      settings: {
       optimizer: {
         enabled: true,
         runs: 200
       },
      }
    }
  }
}
