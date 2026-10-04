// The weather integrations use GET requests with query parameters and JSON bodies.
// Keep that small contract without the deprecated Request dependency tree.
module.exports = async function requestWeather(options) {
  const url = new URL(options.uri);
  for (const [name, value] of Object.entries(options.qs || {})) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(name, String(value));
    }
  }

  const response = await fetch(url, {
    headers: options.headers,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000)
  });

  if (!response.ok) {
    // Do not include the URL, query string, or response body: they can contain keys.
    await response.body?.cancel();
    const error = new Error(`Weather API returned HTTP ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }

  if (response.status === 204) return undefined;
  return response.json();
};
