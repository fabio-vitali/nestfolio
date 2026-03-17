# EventBridge Schedule Per-Environment Control — Research

## 1. EventBridge Scheduler vs EventBridge Rules

| Feature | EventBridge Rules (`aws_events.Rule`) | EventBridge Scheduler (`aws_scheduler`) |
|---|---|---|
| **Enable/Disable at deploy** | `enabled: false` prop on Rule | `enabled: false` prop (L2) or `state: 'DISABLED'` (L1 CfnSchedule) |
| **Schedule types** | rate, cron | rate, cron, **one-time (`at()`)** |
| **Time zone support** | No (UTC only) | Yes (`timeZone` param on cron) |
| **Flexible time window** | No | Yes (jitter window to spread load) |
| **Scale** | Soft limit ~300 rules/bus | Millions of schedules |
| **Target types** | EventBridge targets (Lambda, SQS, SNS, etc.) | 6,000+ API operations (universal targets) |
| **Dead-letter queue** | Via target config | Native DLQ support |
| **Retry policy** | Via target config | Native retry policy (maxRetries + maxAge) |

**Recommendation: Use EventBridge Scheduler** — it has first-class enable/disable, timezone support, flexible time windows, and the L2 construct (`Schedule`) is now in `aws-cdk-lib` (stable).

---

## 2. CDK Patterns for Environment-Conditional Schedules

### Pattern A: Completely disable a schedule in dev/PR

```typescript
import { Schedule, ScheduleExpression } from 'aws-cdk-lib/aws-scheduler';
import { LambdaInvoke } from 'aws-cdk-lib/aws-scheduler-targets';

interface ScheduleConfig {
  enabled: boolean;
  rateMinutes: number;
}

const scheduleConfigs: Record<string, ScheduleConfig> = {
  prod:    { enabled: true,  rateMinutes: 360 },   // every 6h
  staging: { enabled: true,  rateMinutes: 1440 },  // every 24h
  dev:     { enabled: false, rateMinutes: 1440 },   // disabled
  pr:      { enabled: false, rateMinutes: 1440 },   // disabled
};

const env = scope.node.tryGetContext('env') as string ?? 'dev';
const config = scheduleConfigs[env] ?? scheduleConfigs['dev'];

const target = new LambdaInvoke(syncFunction, {
  retryAttempts: 2,
});

new Schedule(this, 'KbSyncSchedule', {
  schedule: ScheduleExpression.rate(Duration.minutes(config.rateMinutes)),
  target,
  enabled: config.enabled,
  description: `KB sync schedule (${env})`,
});
```

Deploy with: `cdk deploy --context env=prod`

### Pattern B: Using SSM Parameter for runtime control

```typescript
import * as ssm from 'aws-cdk-lib/aws-ssm';

// Read SSM at deploy time (synth-time lookup)
const scheduleEnabled = ssm.StringParameter.valueFromLookup(
  this, `/nestfolio/${env}/kb-sync/enabled`
);

// Note: valueFromLookup resolves at synth time, returns 'dummy-value' on first synth
// For deploy-time resolution, use CfnCondition instead:

const isEnabled = new cdk.CfnCondition(this, 'ScheduleEnabled', {
  expression: cdk.Fn.conditionEquals(
    ssm.StringParameter.valueForStringParameter(this, `/nestfolio/${env}/kb-sync/enabled`),
    'true'
  ),
});

// With CfnSchedule L1 (supports conditions):
const schedule = new scheduler.CfnSchedule(this, 'KbSyncSchedule', {
  scheduleExpression: `rate(${rateMinutes} minutes)`,
  flexibleTimeWindow: { mode: 'OFF' },
  state: 'ENABLED',
  target: {
    arn: syncFunction.functionArn,
    roleArn: schedulerRole.roleArn,
  },
});
schedule.cfnOptions.condition = isEnabled;
```

### Pattern C: CDK context with conditional resource creation (simplest)

```typescript
const env = scope.node.tryGetContext('env') as string ?? 'dev';

// Don't even create the schedule in dev/PR
if (env === 'prod' || env === 'staging') {
  new Schedule(this, 'KbSyncSchedule', {
    schedule: env === 'prod'
      ? ScheduleExpression.rate(Duration.hours(6))
      : ScheduleExpression.rate(Duration.hours(24)),
    target: new LambdaInvoke(syncFunction, { retryAttempts: 2 }),
    enabled: true,
    description: `KB sync - ${env}`,
  });
}
```

**Best approach for nestfolio**: Pattern A or C. Pattern A deploys the schedule in DISABLED state (visible in console for debugging). Pattern C doesn't create the resource at all in dev.

---

## 3. EventBridge Scheduler State — Deploy in DISABLED State

### L2 Construct (Schedule)

```typescript
import { Schedule, ScheduleExpression } from 'aws-cdk-lib/aws-scheduler';
import { LambdaInvoke } from 'aws-cdk-lib/aws-scheduler-targets';

new Schedule(this, 'MySchedule', {
  schedule: ScheduleExpression.rate(Duration.hours(6)),
  target: new LambdaInvoke(myFunction),
  enabled: false,  // <-- deploys in DISABLED state
});
```

### L1 Construct (CfnSchedule)

```typescript
import { aws_scheduler as scheduler } from 'aws-cdk-lib';

new scheduler.CfnSchedule(this, 'MySchedule', {
  scheduleExpression: 'rate(6 hours)',
  flexibleTimeWindow: { mode: 'OFF' },
  state: 'DISABLED',  // <-- explicit ENABLED or DISABLED
  target: {
    arn: myFunction.functionArn,
    roleArn: schedulerRole.roleArn,
  },
});
```

### EventBridge Rule (for comparison)

```typescript
import * as events from 'aws-cdk-lib/aws-events';

new events.Rule(this, 'MyRule', {
  schedule: events.Schedule.rate(Duration.hours(6)),
  targets: [new targets.LambdaFunction(myFunction)],
  enabled: false,  // <-- deploys in DISABLED state
});
```

All three approaches support deploying in DISABLED state at deploy time.

---

## 4. Bedrock Knowledge Base Manual Sync from Console

**Yes, you can trigger a sync manually from the AWS console.**

### Console path:
1. Open **Amazon Bedrock console**: `https://console.aws.amazon.com/bedrock/`
2. Left navigation pane -> **Knowledge bases**
3. Select your knowledge base
4. In the **Data source** section, click the **Sync** button

The Sync button triggers a `StartIngestionJob` API call. You can also **Stop** an in-progress sync.

### View sync history:
- Click on a data source -> **Sync history** tab -> **View warnings** for failures

### Programmatic alternative:
```bash
aws bedrock-agent start-ingestion-job \
  --knowledge-base-id <KB_ID> \
  --data-source-id <DS_ID>
```

---

## 5. Alternative: Lambda with Environment-Aware Skip

Pattern where the Lambda itself checks whether to run:

```typescript
// CDK: always deploy the schedule, but pass env var to Lambda
const syncFunction = new lambda.Function(this, 'KbSyncFunction', {
  // ...
  environment: {
    SCHEDULE_ENABLED: env === 'prod' || env === 'staging' ? 'true' : 'false',
    SYNC_INTERVAL_LABEL: env,  // for logging
  },
});

// Always create the schedule (even in dev) — Lambda decides whether to execute
new Schedule(this, 'KbSyncSchedule', {
  schedule: ScheduleExpression.rate(Duration.hours(6)),
  target: new LambdaInvoke(syncFunction),
  enabled: true,
});
```

```typescript
// Lambda handler
export const handler = async (event: ScheduledEvent): Promise<void> => {
  const enabled = process.env.SCHEDULE_ENABLED === 'true';

  if (!enabled) {
    console.log(`Schedule execution skipped (env: ${process.env.SYNC_INTERVAL_LABEL})`);
    return;
  }

  // Proceed with KB sync
  await startIngestionJob();
};
```

**When to use this pattern:**
- When you want the schedule to exist in all environments for observability
- When enable/disable logic depends on runtime state (e.g., feature flags in SSM/AppConfig)
- **Downside**: Lambda still invokes (costs, cold starts) even when skipping

**Recommendation**: Prefer Pattern A (deploy schedule in DISABLED state) over this. It's cheaper and cleaner. Use this pattern only if you need runtime feature-flag control.

---

## Summary Recommendation for Nestfolio

| Concern | Recommendation |
|---|---|
| **Construct** | EventBridge Scheduler L2 (`Schedule` from `aws-cdk-lib/aws-scheduler`) |
| **Per-env control** | Pattern A — map of `{ enabled, rate }` per env, driven by CDK context |
| **Dev/PR envs** | Deploy schedule in `DISABLED` state (visible in console, zero cost) |
| **Staging** | Longer interval (24h), ENABLED |
| **Prod** | Short interval (6h), ENABLED |
| **Manual sync** | Bedrock console -> Knowledge bases -> Data source -> Sync button |
