const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { gzipSync } = require('node:zlib');
const requestWeather = require('../lib/weather-request');

async function fixture(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('weather client encodes query values and parses compressed JSON', async t => {
  const uri = await fixture(t, (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    assert.equal(req.method, 'GET');
    assert.equal(url.searchParams.get('apiKey'), 'fictional&key');
    assert.equal(url.searchParams.get('adminDistrictCode'), 'CA:US');
    assert.equal(url.searchParams.get('next'), 'page+2=/');
    assert.equal(url.searchParams.has('absent'), false);
    assert.equal(req.headers.accept, 'application/json');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
    res.end(gzipSync(JSON.stringify({ alerts: [], metadata: { next: null } })));
  });
  const result = await requestWeather({
    uri,
    qs: { apiKey: 'fictional&key', adminDistrictCode: 'CA:US', next: 'page+2=/', absent: undefined },
    headers: { Accept: 'application/json' },
    json: true
  });
  assert.deepEqual(result, { alerts: [], metadata: { next: null } });
});

test('weather client preserves no-content responses', async t => {
  const uri = await fixture(t, (_, res) => res.writeHead(204).end());
  assert.equal(await requestWeather({ uri }), undefined);
});

test('weather client rejects HTTP failures without leaking credentials or bodies', async t => {
  const uri = await fixture(t, (_, res) => res.writeHead(503).end('fictional-secret'));
  await assert.rejects(requestWeather({ uri, qs: { apiKey: 'fictional-secret' } }), error => {
    assert.equal(error.statusCode, 503);
    assert.equal(error.message, 'Weather API returned HTTP 503');
    return true;
  });
});

test('weather client rejects invalid JSON and network failures', async t => {
  const uri = await fixture(t, (req, res) => {
    if (req.url === '/disconnect') return res.destroy();
    res.end('{invalid JSON');
  });
  await assert.rejects(requestWeather({ uri }), SyntaxError);
  await assert.rejects(requestWeather({ uri: `${uri}/disconnect` }), /fetch failed/);
});

test('weather client refuses redirects before requesting the destination', async t => {
  let destinationRequests = 0;
  const uri = await fixture(t, (req, res) => {
    if (req.url === '/destination') {
      destinationRequests++;
      return res.end('{}');
    }
    res.writeHead(302, { Location: '/destination' }).end();
  });
  await assert.rejects(requestWeather({ uri }), /fetch failed/);
  assert.equal(destinationRequests, 0);
});

test('weather client aborts a stalled response', async t => {
  const uri = await fixture(t, () => {});
  const originalTimeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 30_000);
    return originalTimeout(20);
  });
  await assert.rejects(requestWeather({ uri }), { name: 'TimeoutError' });
});
