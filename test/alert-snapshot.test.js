const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const writeAlertSnapshot = require('../lib/alert-snapshot');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'weather-snapshot-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, file: path.join(directory, 'alerts.json') };
}

test('overlapping long and short saves publish complete JSON snapshots', async t => {
  const { directory, file } = await fixture(t);
  const snapshots = Array.from({ length: 40 }, (_, index) => [{
    detailKey: `alert-${index}`,
    headlineText: index % 2 ? 'short' : 'long'.repeat(100_000)
  }]);
  const serialized = new Set(snapshots.map(snapshot => JSON.stringify(snapshot)));
  await Promise.all(snapshots.map(async snapshot => {
    await writeAlertSnapshot(file, snapshot);
    const stored = await fs.readFile(file, 'utf8');
    assert.doesNotThrow(() => JSON.parse(stored));
    assert.ok(serialized.has(stored), 'Stored data must be one complete submitted snapshot');
  }));
  assert.deepEqual(await fs.readdir(directory), ['alerts.json']);
});

test('failed publication preserves the previous snapshot and removes temporary files', async t => {
  const { directory, file } = await fixture(t);
  const previous = '[{"detailKey":"previous"}]';
  await fs.writeFile(file, previous);
  const failure = Object.assign(new Error('Fictional rename failure'), { code: 'EACCES' });
  t.mock.method(fs, 'rename', async () => { throw failure; });
  await assert.rejects(writeAlertSnapshot(file, [{ detailKey: 'replacement' }]), failure);
  assert.equal(await fs.readFile(file, 'utf8'), previous);
  assert.deepEqual(await fs.readdir(directory), ['alerts.json']);
});

test('failed serialization preserves the previous snapshot', async t => {
  const { directory, file } = await fixture(t);
  const previous = '[{"detailKey":"previous"}]';
  await fs.writeFile(file, previous);
  const circular = {};
  circular.self = circular;
  await assert.rejects(writeAlertSnapshot(file, [circular]), TypeError);
  assert.equal(await fs.readFile(file, 'utf8'), previous);
  assert.deepEqual(await fs.readdir(directory), ['alerts.json']);
});
