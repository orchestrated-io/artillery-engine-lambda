'use strict';

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const aws = require('aws-sdk');
const debug = require('debug')('engine:lambda');
const A = require('async');
const _ = require('lodash');
const helpers = require('artillery/core/lib/engine_util');

const utils = require('./utils');

function LambdaEngine (script, ee) {
  this.script = script;
  this.ee = ee;
  this.helpers = helpers;
  this.config = script.config;

  this.config.processor = this.config.processor || {};

  return this;
}

LambdaEngine.prototype.createScenario = function createScenario (scenarioSpec, ee) {

  // as for http engine we add before and after scenario hook
  // as normal functions in scenario's steps
  const beforeScenarioFns = _.map(
    scenarioSpec.beforeScenario,
    function(hookFunctionName) {
      return {'function': hookFunctionName};
    });
  const afterScenarioFns = _.map(
    scenarioSpec.afterScenario,
    function(hookFunctionName) {
      return {'function': hookFunctionName};
    });

  const newFlow = beforeScenarioFns.concat(
    scenarioSpec.flow.concat(afterScenarioFns));

  scenarioSpec.flow = newFlow;

  const tasks = scenarioSpec.flow.map(rs => this.step(rs, ee,  {
    beforeRequest: scenarioSpec.beforeRequest,
    afterResponse: scenarioSpec.afterResponse,
  }));

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

      context.funcs.$increment = self.$increment;
      context.funcs.$decrement = self.$decrement;
      context.funcs.$contextUid = function () {
        return context._uid;
      };

      const payload = typeof rs.invoke.payload === 'object'
        ? JSON.stringify(rs.invoke.payload)
        : String(rs.invoke.payload);

      // see documentation for a description of these fields
      // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html#invoke-property
      var awsParams = {
        ClientContext: Buffer.from(rs.invoke.clientContext || '{}').toString('base64'),
        FunctionName: rs.invoke.target || self.script.config.target,
        InvocationType: rs.invoke.invocationType || 'Event',
        LogType: rs.invoke.logType || 'Tail',
        Payload: helpers.template(payload, context),
        Qualifier: rs.invoke.qualifier || '$LATEST'
      };

      // build object to pass to hooks
      // we do not pass only aws params but also additional information
      // we need to make the engine work with other plugins
      const params = _.assign({
        url: context.lambda.endpoint.href,
        awsParams: awsParams,
      }, rs.invoke);


      const beforeRequestFunctionNames = _.concat(opts.beforeRequest || [], rs.invoke.beforeRequest || []);

      utils.processBeforeRequestFunctions(
        self.script,
        beforeRequestFunctionNames,
        params,
        context,
        ee,
        function done(err) {
          if (err) {
            debug(err);
            return callback(err, context);
          }

          ee.emit('request');
          const startedAt = process.hrtime();

          // after running "before request" functions
          // the context could have changed
          // we need to rerun template on payload
          awsParams.Payload = helpers.template(payload, context);

          // invoke lambda function
          context.lambda.invoke(awsParams, function (err, data) {

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

            // AWS output is a generic string
            // we need to guess its content type
            const payload = utils.tryToParse(data.Payload);

            // we build a fake http response
            // it is needed to make the lib work with other plugins
            // such as https://github.com/artilleryio/artillery-plugin-expect
            const response = {
              body: payload.body,
              statusCode: data.StatusCode,
              headers: {
                'content-type':  payload.contentType
              },
            };

            helpers.captureOrMatch(
              params,
              response,
              context,
              function captured(err, result) {
                // TODO handle matches
                let haveFailedCaptures = _.some(result.captures, function(v, k) {
                  return v === '';
                });
                
                if (!haveFailedCaptures) {
                  _.each(result.captures, function(v, k) {
                    _.set(context.vars, k, v);
                  });
                }

                const afterResponseFunctionNames = _.concat(opts.afterResponse || [], rs.invoke.afterResponse || []);

                utils.processAfterResponseFunctions(
                  self.script,
                  afterResponseFunctionNames,
                  params,
                  response,
                  context,
                  ee,
                  function done(err) {
                    if (err) {
                      debug(err);
                      return callback(err, context);
                    }
    
                    return callback(null, context);
                  }
                );
              }
            );
            
          });
        }
      )
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

      initialContext.lambda = new aws.Lambda(opts);
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

LambdaEngine.prototype.$increment = function $increment (value) {
  let result = Number.isInteger(value) ? value += 1 : NaN;
  return result;
};

LambdaEngine.prototype.$decrement = function $decrement (value) {
  let result = Number.isInteger(value) ? value -= 1 : NaN;
  return result;
};

module.exports = LambdaEngine;
