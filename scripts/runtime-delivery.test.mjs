import assert from 'node:assert/strict'
import { nextScheduleTime, parseSchedule, parseChannel } from '../netlify/functions/_shared/runtime-delivery/policy.ts'
import { resolveRuntimeDeliveryRoute } from '../netlify/functions/_shared/runtime-delivery/routes.ts'

assert.equal(nextScheduleTime('0 9 * * 1-5', 'Asia/Shanghai', new Date('2026-09-04T01:00:00Z')).toISOString(), '2026-09-07T01:00:00.000Z')
assert.equal(nextScheduleTime('0 0 29 2 *', 'UTC', new Date('2026-01-01Z')).toISOString(), '2028-02-29T00:00:00.000Z')
assert.equal(nextScheduleTime('0 3 * * *', 'America/New_York', new Date('2026-03-08T06:00:00Z')).toISOString(), '2026-03-08T07:00:00.000Z')
assert.equal(nextScheduleTime('30 2 * * *', 'America/New_York', new Date('2026-03-08T06:00:00Z')).toISOString(), '2026-03-08T07:00:00.000Z')
for (const [cron,tz] of [['* * * * * *','UTC'],['* * * * *','Invalid/Test'],['90 * * * *','UTC']]) assert.throws(() => nextScheduleTime(cron,tz,new Date()), {status:422})
assert.equal(parseSchedule({name:' daily ',workflowId:'w',workflowVersion:'v1',cronExpression:'* * * * *'}).input, '{}')
assert.deepEqual(parseSchedule({name:'x'}, true), {name:'x'})
assert.throws(() => parseSchedule({input:'{'},true), {status:422})
assert.equal(parseSchedule({input:'42'},true).input,'42')
assert.throws(() => parseChannel({name:'X',channelType:'email',config:{nested:{token:'do-not-store'}}}), {status:422})
assert.equal(resolveRuntimeDeliveryRoute('POST','/api/workspaces/a/notifications/outbox/n/requeue').operation, 'outbox-requeue')
assert.equal(resolveRuntimeDeliveryRoute('GET','/api/workspaces/a%2Fb/schedules'), null)
console.log('runtime delivery policy: 13 checks passed')
