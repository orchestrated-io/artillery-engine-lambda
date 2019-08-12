/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

const _ = require('lodash');

const aws = require('aws-sdk');
const awsMock = require('aws-sdk-mock');

// allow aws overriding
awsMock.setSDKInstance(aws);

const test = require('tape');
const sinon = require('sinon');

const EventEmitter = require('events');

const LambdaEngine = require('..');

const script = {
  config: {
    target: 'my_awesome_function',
    lambda: {
      region: 'us-east-1'
    },
  },
  scenarios: [{
    name: 'Invoke function',
    engine: 'lambda',
    beforeRequest: 'beforeRequest',
    afterResponse: 'afterResponse',
    flow: [
      {
        invoke: {
          payload: { title: 'A very boring payload' }
        }
      },
      {
        invoke: {
          target: 'my_other_function',
          payload: { title: 'A somewhat boring payload' }
        }
      },
      {
        invoke: {
          payload: { title: 'A payload with incrementing function: {{$increment(3)}}' }
        }
      },
      {
        invoke: {
          payload: { title: 'A payload with decrementing function: {{$decrement(3)}}' }
        }
      }
    ]
  }]
};

function setup() {
  awsMock.mock('Lambda', 'invoke', function(params, cb) {
    return cb(null, {
      StatusCode: 200,
      Payload: '{ "result": "OK" }',
    });
  });
}

function teardown() {
  awsMock.restore('Lambda');
}

test('Engine interface', function (t) {
  const events = new EventEmitter();
  const engine = new LambdaEngine(script, events, {});
  const scenario = engine.createScenario(script.scenarios[0], events);
  t.assert(engine, 'Can construct an engine');
  t.assert(typeof scenario === 'function', 'Can create a scenario');
  t.end();
});

test('Lambda engine template functions', function (t) {
  const events = new EventEmitter();
  const engine = new LambdaEngine(script, events, {});
  const context = {
    vars: {},
    funcs: {
      $increment: engine.$increment,
      $decrement: engine.$decrement
    }
  };
  t.equal(engine.helpers.template('{{$increment(3)}}', context), '4', 'Can call $increment');
  t.equal(engine.helpers.template('{{$decrement(3)}}', context), '2', 'Can call $decrement');
  t.end();
});

test('Scenario before/after hooks are called', function (t) {

  // setup mocks
  setup();

  function beforeRequest(r, c, e, done) {
    return done();
  };
  function afterResponse(r, d, c, e, done) {
    return done();
  };

  const scriptWithHooks = _.clone(script);
  scriptWithHooks.config.processor = {
    beforeRequest: beforeRequest,
    afterResponse: afterResponse,
  };

  const beforeRequestSpy = sinon.spy(scriptWithHooks.config.processor, 'beforeRequest');
  const afterRequestSpy = sinon.spy(scriptWithHooks.config.processor, 'afterResponse');

  const events = new EventEmitter();
  const engine = new LambdaEngine(scriptWithHooks, events, {});
  const context = {
    vars: {},
    funcs: {
      $increment: engine.$increment,
      $decrement: engine.$decrement
    }
  };
  const runScenario = engine.createScenario(script.scenarios[0], events);
  runScenario(context, function() {
    t.end();

    t.equal(beforeRequestSpy.callCount, 4);
    t.equal(afterRequestSpy.callCount, 4);

    // tear down mocks
    teardown();
  });
});
