# Artillery.io AWS Lambda Plugin

<p align="center">
    <em>Load test AWS Lambda with <a href="https://artillery.io">Artillery.io</a></em>
</p>

Based on the [Kinesis Engine by Shoreditch](https://github.com/shoreditch-ops/artillery-engine-kinesis).

## Usage

**Important:** The plugin requires Artillery `1.5.8-3` or higher.

### Install the plugin

```
# If Artillery is installed globally:
npm install -g artillery-engine-lambda
```

### Use the plugin

1. Set `config.target` to the name of the Lambda function
2. Specify additional options in `config.lambda`:
    - `region` - AWS region (**default**: `us-east-1`)
3. Set the `engine` property of the scenario to `lambda`.
4. Use `invoke` in your scenario to invoke the Lambda function
5. Specify additional invocation parameters:
    - `payload` - String or object with the payload to send to the Lambda function
    - `invocationType` - Lambda invocation type. One of `Event`, `RequestResponse`, `DryRun`
    - `logType` - One of `None`, `Tail`
    - `qualifier` - Lambda qualifier
    - `clientContext` - client context to pass to the Lambda function as context
    - `target` - invocation specific target overriding global default in `config.target`.

#### Example Script

```yaml
config:
  target: "lambda_function_name"
  lambda:
    region: "us-east-1"
  phases:
    arrivalCount: 10
    duration: 1
  engines:
    lambda: {}

scenarios:
  - name: "Invoke function"
    engine: "lambda"
    flow:
      - loop:
        - invoke:
           # data may be a string or an object. Objects
           # will be JSON.stringified.
           clientContext: '{"app": "MyApp"}'
           invocationType: "Event"
           logType: "Tail"
           payload: "Some payload"
           qualifier: "1"
        - think: 1
        count: 100
```

(See [example.yml](example.yml) for a complete example.)

### Run Your Script

```
AWS_PROFILE=dev artillery run my_script.yml
```

### License

[MPL 2.0](https://www.mozilla.org/en-US/MPL/2.0/)
