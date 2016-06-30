'use strict'

let Restify = require('restify')
const Promise = require('bluebird')
const Util = require('util')
const Path = require('path')
const ChildProcess = require('child_process')
const _ = require('lodash')

const sprintf = Util.format

module.exports = port => {
  let server = Restify.createServer({
    name: 'Project manager'
  })

  server.use(Restify.bodyParser())

  let packages = { }

  let trackPackage = (data) => {
    console.dir(data)
    packages[data.name] = data

    console.log('Now tracking package %s', data.name)
  }

  let cmdStream = (cmd, args, cwd, stream) => new Promise((resolve, reject) => {
    try {
      console.log('running cmd %s', cmd)
      let shell = ChildProcess.spawn(cmd, args, {
        cwd: cwd
      })

      shell.stdout.on('data', data => {
        stream.write(data)
      })
      shell.stderr.on('data', data => {
        stream.write(data)
      })
      shell.on('close', code => {
        stream.write('\n')
        if (code === 0) {
          resolve()
        }
        else {
          reject(code)
        }
      })

      shell.on('error', err => {
        console.log(err)
        stream.write(err.stack.toString())
        reject()
      })
    }
    catch (err) {
      stream.write(err + '\n')
      reject()
    }
  })

  let publishPackage = Promise.coroutine(function*(data, stream) {
    let path = Path.resolve(data.path)
    let publishCmds = data.publish

    let i = -1
    let limit = publishCmds.length

    while (++i < limit) {
      //let cmdSeq = require('minimist')(publishCmds[i].split(' '))['_']
      let cmdSeq = publishCmds[i].split(' ')

      if (cmdSeq[0] === '?') {
        cmdSeq = _.tail(cmdSeq)
        stream.write(publishCmds[i] + '\n')
        yield cmdStream(
          _.head(cmdSeq),
          _.tail(cmdSeq),
          path,
          stream
        ).catch(() => undefined)
      }
      else {
        stream.write(publishCmds[i] + '\n')
        yield cmdStream(
          _.head(cmdSeq),
          _.tail(cmdSeq),
          path,
          stream
        )
      }
    }
  })

  let publishPackage_old = Promise.coroutine(function*(data, stream) {
    if (data === undefined) {
      return;
    }

    let path = Path.resolve(data.path)
    yield cmdStream(
      'cd',
      [ path ],
      path,
      stream
    )

    if (data.scripts.gen) {
      console.log('Running code generator')
      stream.write('Running code generator...\n')
      yield cmdStream(
        'npm',
        [ 'run', 'gen' ],
        path,
        stream
      )
    }

    stream.write('Publishing project...\n')
    yield cmdStream(
      'sbt',
      [ 'publish-local' ],
      path,
      stream
    )

    if (data.onPublish === 'docker') {
      stream.write('Removing old docker image...\n')
      yield cmdStream('docker', [ 'rmi', data.dockerId ], path, stream).catch(() => undefined)

      stream.write('Building docker image...\n')
      yield cmdStream('sbt', [ 'docker' ], path, stream)

      stream.write('Removing old docker image...\n')
      yield cmdStream('docker', [ 'rm', '-f', data.dockerName ], path, stream).catch(() => undefined)

      stream.write('Deplying docker image...\n')
      yield cmdStream('docker', [ 'run', '-d', '--name', data.dockerName, data.dockerId ], path, stream)
    }
  })

  let updatePackage = Promise.coroutine(function*(packageName, stream) {
    stream.write(sprintf(
      'Updating %s', packageName
    ))

    yield publishPackage(packages[packageName], stream)

    let i = -1
    let keys = _.keys(packages)
    let limit = keys.length

    while (++i < limit) {
      let data = packages[keys[i]]

      if (_.includes(_.keys(data.dependencies), packageName)) {
        stream.write(sprintf(
          'Project %s depends on current project, updating...', data.name
        ))
        yield updatePackage(data.name, stream)
        //yield publishPackage(data, stream)
      }
    }
  })

  let updatePackage_old = packageName => {
    console.log('Updating %s', packageName)
    let publishRes = {
      publish: publishPackage(packages[packageName])
    }

    let results = _.map(packages, data => {
      console.log('Checking if %s is dependent on %s', data.name, packageName)
      console.dir(data.dependencies)
      if (_.includes(_.keys(data.dependencies), packageName)) {
        // Issue an update to this package.
        updatePackage(data.name)
        return {
          publish: publishPackage(data)
        }
      }
    })

    return results.concat(publishRes)
  }

  server.post('/project', (req, res, next) => {
    try {
      console.log(req.body)
      let results = _.filter(trackPackage(JSON.parse(req.body)))
      res.send(results)
    }
    catch (err) {
      console.log(err.stack.toString())
      console.dir(err)
      throw err
    }
  })

  server.get('/project/:project/:id/update', (req, res, next) => {
    let id = req.params.project + '/' + req.params.id
    res.writeHead(200, {
      'Content-Type': 'text/plain'
    })
    res.write('Updating path ' + id + '\n')

    updatePackage(id, res)
    .then(() => {
      res.write('\n')
      res.end()
    })
    .catch(err => {
      if (err.stack) {
        res.write(sprintf('Error: %s\n', err.stack.toString()))
      }
      else {
        res.write(sprintf('Error: %s\n', err))
      }
      res.write('FAILED')
      res.end()
    })
  })

  server.listen(port)
}
