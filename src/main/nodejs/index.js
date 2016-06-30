'use strict'

const config = require('./config')()

if (config.longRunning) {
  require('./background')(5400)
  return
}

// Use http to communicate with background server.
const request = require('request')
const fs = require('fs')
const _ = require('lodash')
const ChildProcess = require('child_process')
const Util = require('util')

const sprintf = Util.format

let projectFile = JSON.parse(fs.readFileSync('pman.json'))

projectFile.path = process.cwd()

// Upload this project to the tracker.
request.post({
  url: 'http://localhost:5400/project',
  method: 'POST',
  headers: {
    'content-type': 'application/json'
  },
  json: JSON.stringify(projectFile)
})
console.log('Uploaded')

let argv = process.argv
let i = 2
let method = argv[i]

console.log('Argv = %j', argv)

if (method === 'git') {
  let gitCmd = argv[i + 1]
  if (gitCmd === 'push') {
    let cmd = argv.slice(i).join(' ')

    request(
      { method: 'GET',
        headers: {
          'content-type': 'text/plain'
        },
        uri: 'http://localhost:5400/project/' + projectFile.name + '/update'
      },
      (err, resp, body) => {
        if (err) {
          if (err.stack) {
            process.stderr.write(err.stack.toString())
          }
          else {
            process.stderr.write(err.toString())
          }
          return
        }
        if (body.endsWith('FAILED')) {
          process.stderr.write('\nProject builds failed.\n')
          return
        }


        ChildProcess.execSync(cmd)
      }
    ).on('data', data => process.stdout.write(data))
  }
  else {
    let cmd = argv.slice(i).join(' ')
    console.log('<<< %s', cmd)
    let out = ChildProcess.execSync(cmd)
    console.log('>>> %s', out)
  }
}
