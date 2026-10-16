import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollInterval } from '../public/sync-timing.js';
test('automatic room refresh stays within the free daily budget for a six-hour 4-to-25-person event', () => {
  for (let participants = 4; participants <= 25; participants++) {
    const interval = pollInterval(participants);
    const sixHoursOfPolling = Math.ceil(6 * 3600000 / interval) * participants;
    assert.ok(sixHoursOfPolling <= 90000, `${participants} participants leave room for game actions in the 100000-request allowance`);
    assert.ok(interval >= 1500 && interval <= 6500, 'screens remain responsive without excessive background requests');
  }
});
test('an absent or invalid roster cannot create an aggressive refresh loop', () => {
  for (const count of [undefined, NaN, Infinity, -20, 0]) assert.ok(pollInterval(count) >= 1500);
});
