const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const express = require('express');
const { createApp } = require('../app');
const setupHTTP = require('../middleware/global-handlers');
const config = require('../config');

async function listen(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function fixture(t, request = async () => ({ alerts: [], metadata: { next: null } })) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'weather-alerts-test-'));
  const alertsFile = path.join(directory, 'alerts.json');
  const scheduled = new Map();
  const timers = {
    setInterval(callback, milliseconds) {
      const timer = {};
      scheduled.set(timer, { callback, milliseconds });
      return timer;
    },
    clearInterval(timer) { scheduled.delete(timer); }
  };
  const app = createApp({ request, alertsFile, timers });
  app.set('env', 'test');
  t.after(async () => {
    app.locals.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { app, alertsFile, scheduled, base: await listen(t, app) };
}

async function post(base, route, body, contentType = 'application/json') {
  return fetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

async function readCompletedAlerts(file) {
  // Enrichment and the output stream complete after the summary response.
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      await delay(10);
    }
  }
  assert.fail('The aggregated alerts file was not written');
}

function alert(detailKey, overrides = {}) {
  return {
    detailKey, latitude: 34, longitude: -118, significance: 'W', phenomena: 'FW',
    certaintyCode: 1, urgencyCode: 1, severityCode: 1, headlineText: 'Fictional fire warning',
    officeName: 'Test office', officeAdminDistrictCode: 'CA', officeCountryCode: 'US',
    source: 'Fictional fixtures', disclaimer: 'Test data', ...overrides
  };
}

test('creating the app does not call a weather provider or create an output file', async t => {
  let calls = 0;
  const { alertsFile } = await fixture(t, async () => { calls++; });
  assert.equal(calls, 0);
  await assert.rejects(fs.access(alertsFile), { code: 'ENOENT' });
});

test('alerts are filtered, enriched by literal key, written and served as JSON', async t => {
  const keys = ['ordinary-key', 'key"\\with[syntax]'];
  const requests = [];
  const { base, alertsFile } = await fixture(t, async options => {
    requests.push(options);
    if (options.uri.endsWith('/headlines')) {
      return { alerts: [alert(keys[0]), alert(keys[1], { latitude: 35 }),
        alert('filtered-out', { phenomena: 'XX' })], metadata: { next: null } };
    }
    return { temperature: options.qs.geocode.startsWith('34,') ? 90 : 80 };
  });
  const summary = await fetch(base + config.getAlertsSummaryENDPOINT());
  assert.equal(summary.status, 200);
  assert.deepEqual((await summary.json()).map(item => item.detailKey), keys);
  const stored = await readCompletedAlerts(alertsFile);
  assert.deepEqual(stored.map(item => [item.detailKey, item.cod.temperature]), [[keys[0], 90], [keys[1], 80]]);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].qs.adminDistrictCode, 'CA:US');
  const details = await fetch(base + config.getAlertsDetailsENDPOINT());
  assert.match(details.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await details.json(), stored);
});

test('a headline request failure is handled without writing alerts', async t => {
  const messages = [];
  t.mock.method(console, 'error', message => messages.push(message));
  const { base, alertsFile } = await fixture(t, async () => { throw new Error('Fictional outage'); });
  const response = await fetch(base + config.getAlertsSummaryENDPOINT());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
  assert.deepEqual(messages, ['Fictional outage']);
  await assert.rejects(fs.access(alertsFile), { code: 'ENOENT' });
});

test('an observation failure does not overwrite an existing alert snapshot', async t => {
  const messages = [];
  t.mock.method(console, 'error', message => messages.push(message));
  const { app, alertsFile } = await fixture(t, async options => {
    if (options.uri.endsWith('/headlines')) return { alerts: [alert('key')], metadata: { next: null } };
    throw new Error('Observation unavailable');
  });
  await fs.writeFile(alertsFile, '[{"previous":true}]');
  await app.locals.refreshAlerts();
  await delay(0);
  assert.deepEqual(messages, ['Observation unavailable']);
  assert.equal(await fs.readFile(alertsFile, 'utf8'), '[{"previous":true}]');
});

test('timer configuration accepts JSON and forms, replaces the timer, and stops polling', async t => {
  let calls = 0;
  const { base, scheduled } = await fixture(t, async () => {
    calls++;
    return { alerts: [], metadata: { next: null } };
  });
  let response = await post(base, config.getConfigureAlertsENDPOINT(), { interval: 2 });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).interval, 120_000);
  assert.equal(scheduled.size, 1);
  response = await post(base, config.getConfigureAlertsENDPOINT(), 'interval=3', 'application/x-www-form-urlencoded');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).interval, 180_000);
  assert.equal(scheduled.size, 1);
  const timer = [...scheduled.values()][0];
  assert.equal(timer.milliseconds, 180_000);
  timer.callback();
  await delay(0);
  assert.equal(calls, 1);
  response = await post(base, config.getStopFrequentAlertsENDPOINT(), {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'success');
  assert.equal(scheduled.size, 0);
});

test('missing intervals and malformed JSON produce errors rendered by Pug', async t => {
  const { base } = await fixture(t);
  let response = await post(base, config.getConfigureAlertsENDPOINT(), {});
  assert.equal(response.status, 400);
  assert.equal((await response.json()).status, 'disabled');
  response = await post(base, config.getConfigureAlertsENDPOINT(), '{bad JSON');
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(await response.text(), /<!DOCTYPE html>/i);
});

test('static resources and escaped 404 error templates still render', async t => {
  const { base } = await fixture(t);
  let response = await fetch(base + '/stylesheets/style.css');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/css/);
  assert.ok((await response.text()).length > 0);
  response = await fetch(base + '/missing');
  assert.equal(response.status, 404);
  assert.match(await response.text(), /Not Found/);
  const pug = require('pug');
  const html = pug.renderFile(path.join(__dirname, '../views/error.pug'), { message: '<script>alert(1)</script>', error: {} });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
});

test('middleware preserves nested form fields and arrays and enforces body limits', async t => {
  const app = express();
  setupHTTP(app);
  app.post('/echo', (req, res) => res.json(req.body));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.type }));
  const base = await listen(t, app);
  let response = await post(base, '/echo', 'interval=5&area[states][]=CA&area[states][]=NV', 'application/x-www-form-urlencoded');
  assert.deepEqual(await response.json(), { interval: '5', area: { states: ['CA', 'NV'] } });
  response = await post(base, '/echo', { interval: 5, area: { states: ['CA', 'NV'] } });
  assert.deepEqual(await response.json(), { interval: 5, area: { states: ['CA', 'NV'] } });
  for (const contentType of ['application/json', 'application/x-www-form-urlencoded']) {
    response = await post(base, '/echo', contentType === 'application/json'
      ? JSON.stringify({ data: 'x'.repeat(110_000) }) : 'data=' + 'x'.repeat(110_000), contentType);
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, 'entity.too.large');
  }
});
