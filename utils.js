const A = require('async');
const _ = require('lodash');

const helpers = require('artillery/core/lib/engine_util');

function doNothing() { 
  const cb = arguments[arguments.length - 1];
  return cb(null); 
};

function processBeforeRequestFunctions(script, functionNames, params, context, ee, done) {
  A.eachSeries(
    functionNames,
    function iteratee(functionName, next) {
      let fn = helpers.template(functionName, context);
      let processFunc = script.config.processor[fn];
      if (!processFunc) {
        processFunc = doNothing;
        console.log(`WARNING: custom function ${fn} could not be found`);
      }
      processFunc(params, context, ee, function(err) {
        if (err) {
          return next(err);
        }
        return next(null);
      });
    },
    done,
  );
}

function processAfterResponseFunctions(script, functionNames, params, response, context, ee, done) {
  A.eachSeries(
    functionNames,
    function iteratee(functionName, next) {
      let fn = helpers.template(functionName, context);
      let processFunc = script.config.processor[fn];
      if (!processFunc) {
        processFunc = doNothing;
        console.log(`WARNING: custom function ${fn} could not be found`);
      }
      processFunc(params, response, context, ee, function(err) {
        if (err) {
          return next(err);
        }
        return next(null);
      });
    },
    done,
  );
}

/**
 * try to parse a string and infer its content type.
 * Return the input if failure.
 * 
 * @param {string} data
 */
function tryToParse(data) {
  const result = {};
  try {
    result.body = JSON.parse(data);
    result.contentType = 'application/json';
  } catch (e) {
    result.body = data;
    result.contentType = '';
  }
  return result;
}

module.exports = {
  processBeforeRequestFunctions: processBeforeRequestFunctions,
  processAfterResponseFunctions: processAfterResponseFunctions,
  tryToParse: tryToParse
};