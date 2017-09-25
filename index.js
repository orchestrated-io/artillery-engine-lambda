'use strict';

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Lambda = require('aws-sdk/clients/lambda');
const debug = require('debug')('engine:lambda');
const A = require('async');
const _ = require('lodash');

function LambdaEngine (script, ee, helpers) {
  this.script = script;
  this.ee = ee;
  this.helpers = helpers;

  return this;
}

LambdaEngine.prototype.createScenario = function createScenario (scenarioSpec, ee) {
  const tasks = scenarioSpec.flow.map(rs => this.step(rs, ee));

  return this.compile(tasks, scenarioSpec.flow, ee);
};

LambdaEngine.prototype.step = function step (rs, ee) {
  const self = this;

  if (rs.loop) {
    const steps = rs.loop.map(loopStep => this.step(loopStep, ee));

    return this.helpers.createLoopWithCount(rs.count || -1, steps);
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
           ClientContext: rs.invoke.clientContext || "", //base64 encode
           FunctionName: self.script.config.target, 
           InvocationType: rs.invoke.invocationType || "Event", 
           LogType: rs.invoke.logType || "Tail", 
           Payload: payload,
           Qualifier: rs.invoke.qualifier || "1"
      };

      ee.emit('request');
      context.lambda.invoke(params, function (err, data) {
        if (err) {
          debug(err);
          ee.emit('error', err);
          return callback(err, context);
        }

        ee.emit('response', 0, 0, context._uid); // FIXME
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
