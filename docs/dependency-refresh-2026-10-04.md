# Combined dependency refresh — 4 October 2026

Prepared from `master` at `d8730aa3ef7ca3d7e43d65c06422522be2cc05af` in the
Weather-Alert-App checkout. The older CallForCode checkout was not modified.
The stale dependency PRs #2–#5 supplied review context; their v1 lockfile patches
were not applied. This change regenerates the current v3 lockfile together.

## Changes

| Component | Resolved version or replacement |
| --- | --- |
| Express | 4.22.3, retaining the Express 4 API |
| HTTP errors | 2.0.1, explicitly declared because application code imports it |
| Morgan | 1.12.1 |
| Method Override | 3.0.0 |
| Jade | Replaced by Pug 3.0.4; all three templates renamed to `.pug` |
| Request / Request Promise Native | Removed; a small built-in `fetch` client handles the application's GET/query/JSON contract |
| JSONPath | Removed; the one active lookup uses literal `detailKey` equality |

Removing the obsolete dependency trees also removes Lodash and Ajv, so the old
PRs' target versions are no longer relevant to the resulting runtime tree.
No dependency overrides, forced audit fixes, or advisory suppressions are used.
Middleware uses Express's built-in JSON and URL-encoded parsers.

Node 22 or newer is now required. The weather client parses JSON, handles
compressed responses, treats HTTP 204 as no content, rejects non-success status
codes and malformed JSON, times out after 30 seconds, and refuses redirects.
Any provider redirect must be handled by configuring the final trusted endpoint.
HTTP status errors omit the URL, query string and response body.

The `createApp` factory allows isolated regression tests. The CLI retains its
initial refresh and listener. Each app has its own state and timers, with a
disposal hook for timer/listener cleanup. Reconfiguring the interval clears the
previous timer. Alert output now ends its writable stream and can create the
file without first unlinking an existing file.

## Validation

The baseline and final lockfiles were audited against the public npm registry
using Node 24.13.1 / npm 11.8.0 with isolated empty npm configuration. The baseline
audit used a temporary copy of the original manifests. The final install used
`npm ci --ignore-scripts`; no package lifecycle scripts ran.

| Lockfile | Critical | High | Moderate | Low | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline master | 12 | 5 | 6 | 5 | 28 |
| Combined refresh | 0 | 0 | 0 | 0 | 0 |

Counts are npm's package-level vulnerability reports, not unique CVEs or proven
exploit paths. They describe the registry's findings on this date, not a guarantee
that the application is free of security defects.

Fourteen regression tests cover:

- Weather query encoding, compressed JSON, no-content responses, HTTP/network
  failures, malformed JSON, blocked redirects, and timeouts.
- Filtering and enrichment, literal alert keys containing expression characters,
  file creation, and serving the stored snapshot.
- Headline and observation failures without unintended file replacement.
- JSON and form interval configuration, timer replacement, polling, and stop.
- Nested form arrays, JSON parsing, malformed requests, and default body limits.
- Static CSS, Pug error rendering, and escaped template messages.

Tests use loopback servers, mocked weather data, controlled timers, and temporary
files. They do not use live weather services or modify the tracked alert snapshot.
All 14 tests passed locally on Node 22.23.2 and Node 24.13.1. The Node 22 run
required permission to bind loopback test servers after the sandbox denied it.
CI is configured to run installation, tests, and the audit on Node 22 and 24.
The official checkout and setup-node actions are pinned to verified release
commits (v7.0.1 and v7.0.0). Hosted CI had not run at the time of local validation.

## Remaining boundaries

This is dependency remediation with focused compatibility tests. No live provider
or IBM Cloud deployment was exercised. The archived `app.js-old` is not an
entrypoint and is not migrated. Existing pagination behavior, overlapping refresh
coordination, stale snapshots after empty/failed fetches, and broader interval
validation remain outside this change. In particular, a headline failure still
returns the existing in-memory alert list, and the summary can return before
observation enrichment finishes. The tests do not certify those broader behaviors.

At the time of local validation, no old PR had been merged or closed, and no
commit had been pushed or deployed.
