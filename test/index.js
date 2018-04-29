/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

const test = require('tape');
const EventEmitter = require('events');

const LambdaEngine = require('..');

const script = {
  config: {
    target: 'my_awesome_function',
    lambda: {
      region: 'us-east-1'
    }
  },
  scenarios: [{
    name: 'Invoke function',
    engine: 'lambda',
    flow: [
      {
        invoke: {
          payload: 'A very boring payload'
        }
      },
      {
        invoke: {
          target: 'my_other_function',
          payload: 'A somewhat boring payload'
        }
      },
      {
        invoke: {
          payload: 'A payload with incrementing function: {{$increment(3)}}'
        }
      },
      {
        invoke: {
          payload: 'A payload with decrementing function: {{$decrement(3)}}'
        }
      }
    ]
  }]
};

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
