// FORKED TO REMOVE FILTERING APPLIED TO INDEXED DATA RESULT
// AND ADD unbox OPTION

'use strict'
var pull = require('pull-stream')
var query = require('flumeview-query/query')
var select = require('flumeview-query/select')
var mfr = require('map-filter-reduce')
var u = require('flumeview-query/util')
var Flatmap = require('pull-flatmap')
var FlumeViewLevel = require('flumeview-level')

var isArray = Array.isArray

module.exports = function (indexes, links, version, unbox) {
  if(!links)
    links = function (data, emit) { emit(data) }

  function getIndexes (data, seq) {
    var A = []
    indexes.forEach(function (index) {
      var a = [index.key]
      for(var i = 0; i < index.value.length; i++) {
        var key = index.value[i]
        if(!u.has(key, data)) return
        a.push(u.get(key, data))
      }
      a.push(seq)
      A.push(a)
    })
    return A
  }

  var create = FlumeViewLevel(version || 1, function (msg, seq) {
    var result = []
    if (typeof msg.value.content === 'string' && unbox) {
      msg = unbox(msg)
    }
    links(msg, function (value) {
      result = result.concat(getIndexes(value, seq))
    })
    return result
  })

  return function (log, name) {
    var index = create(log, name)
    var read = index.read

    index.read = function (opts) {

      opts = opts || {}
      var _opts = {}
      var q, k

      if(isArray(opts.query)) {
        q = opts.query[0].$filter || {}
      }
      else if(opts.query) {
        q = opts.query
      }
      else
        q = {}

      var index = select(indexes, q)

      // HACK: allow manual selection of indexes
      if (opts.index) {
        index = indexes.find(x => x.key === opts.index)
      }

      if(!index)
        return pull(
          log.stream({
            values: true, seqs: false, live: opts.live, limit: opts.limit, reverse: opts.reverse
          }),
          Flatmap(function (data) {
            var emit = []
            links(data, function (a) {
              emit.push(a)
            })
            return emit
          })
        )
      var _opts = query(index, q)

      _opts.values = true
      _opts.keys = true

      _opts.reverse = !!opts.reverse
      _opts.live = opts.live
      _opts.old = opts.old
      _opts.sync = opts.sync
      _opts.limit = opts.limit

      return pull(
        read(_opts),
        pull.map(function (data) {
          if (data.sync) return data
          var msg = data.value
          if (typeof msg.value.content === 'string' && unbox) {
            msg = unbox(msg)
          }
          for (var i = 0; i < index.value.length; i++) {
            u.set(index.value[i], data.key[i + 1], msg)
          }
          return msg
        }),
        isArray(opts.query) ? mfr(opts.query) : pull.through()
      )
    }
    return index
  }
}
