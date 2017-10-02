'use strict';

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Lambda = require('aws-sdk/clients/lambda');
const debug = require('debug')('engine:lambda');
const A = require('async');
const _ = require('lodash');
const helpers = require('artillery-core/lib/engine_util');

function LambdaEngine (script, ee) {
  this.script = script;
  this.ee = ee;
  this.helpers = helpers;
  this.config = script.config;

  return this;
}

LambdaEngine.prototype.createScenario = function createScenario (scenarioSpec, ee) {
  const tasks = scenarioSpec.flow.map(rs => this.step(rs, ee));

  return this.compile(tasks, scenarioSpec.flow, ee);
};

LambdaEngine.prototype.step = function step (rs, ee, opts) {
  opts = opts || {};
  let self = this;

  if (rs.loop) {
    let steps = _.map(rs.loop, function (rs) {
      return self.step(rs, ee, opts);
    });

    return this.helpers.createLoopWithCount(
      rs.count || -1,
      steps,
      {
        loopValue: rs.loopValue || '$loopCount',
        overValues: rs.over,
        whileTrue: self.config.processor
          ? self.config.processor[rs.whileTrue] : undefined
      });
  }

  if (rs.log) {
    return function log (context, callback) {
      return process.nextTick(function () { callback(null, context); });
    };
  }

  if (rs.think) {
    return this.helpers.createThink(rs, _.get(self.config, 'defaults.think', {}));
  }

  if (rs.function) {
    return function (context, callback) {
      let func = self.config.processor[rs.function];
      if (!func) {
        return process.nextTick(function () { callback(null, context); });
      }

      return func(context, ee, function () {
        return callback(null, context);
      });
    };
  }

  if (rs.invoke) {
    return function invoke (context, callback) {
      const payload = typeof rs.invoke.payload === 'object'
            ? JSON.stringify(rs.invoke.payload)
            : String(rs.invoke.payload);

      var params = {
        ClientContext: Buffer.from(rs.invoke.clientContext || '{}').toString('base64'),
        FunctionName: rs.invoke.target || self.script.config.target,
        InvocationType: rs.invoke.invocationType || 'Event',
        LogType: rs.invoke.logType || 'Tail',
        Payload: helpers.template(payload, context),
        Qualifier: rs.invoke.qualifier || '$LATEST'
      };

      ee.emit('request');
      const startedAt = process.hrtime();
      context.lambda.invoke(params, function (err, data) {
        if (err) {
          debug(err);
          ee.emit('error', err);
          return callback(err, context);
        }

        let code = data.StatusCode || 0;
        const endedAt = process.hrtime(startedAt);
        let delta = (endedAt[0] * 1e9) + endedAt[1];
        ee.emit('response', delta, code, context._uid);
        debug(data);
        return callback(null, context);
      });
    };
  }

  return function (context, callback) {
    return callback(null, context);
  };
};

LambdaEngine.prototype.compile = function compile (tasks, scenarioSpec, ee) {
  const self = this;
  return function scenario (initialContext, callback) {
    const init = function init (next) {
      let opts = {
        region: self.script.config.lambda.region || 'us-east-1'
      };

      if (self.script.config.lambda.function) {
        opts.endpoint = self.script.config.lambda.function;
      }

      initialContext.lambda = new Lambda(opts);
      ee.emit('started');
      return next(null, initialContext);
    };

    let steps = [init].concat(tasks);

    A.waterfall(
      steps,
      function done (err, context) {
        if (err) {
          debug(err);
        }

        return callback(err, context);
      });
  };
};

module.exports = LambdaEngine;
