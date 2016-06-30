'use strict'

const _ = require('lodash')

const argv = process.argv
const config = { }

var i = -1
var length = argv.length

while (++i < length) {
  var arg = argv[i]

  if (arg === '-d') {
    config.longRunning = true
  }
}

if (config.longRunning === undefined) {
  config.longRunning = false
}

module.exports = () => config
