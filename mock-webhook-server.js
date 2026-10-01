/**
 * Standalone mock responder for webhook/error-handling tests.
 *
 * Serves one route per error scenario, each returning the status code and
 * JSON body from the error-handling table. No dependencies, no GitHub
 * account needed — just Node.js.
 *
 * Run:
 *   node mock-webhook-server.js
 *   (optionally) PORT=4000 node mock-webhook-server.js
 *
 * Then point whatever you're testing at, e.g.:
 *   http://localhost:3000/recipient-rejected
 *   http://localhost:3000/endpoint-unavailable
 *
 * To expose this to something that needs a public URL (e.g. a real webhook
 * sender running elsewhere), tunnel it with ngrok or similar:
 *   ngrok http 3000
 */

const http = require('http');

const routes = {
  '/internal-error': {
    status: 500,
    body: { error: 'INTERNAL_ERROR', retryable: true, message: 'Internal error' },
  },
  '/config-missing': {
    status: 500,
    body: { error: 'CONFIG_MISSING', retryable: false, message: 'Internal error' },
  },
  '/provider-unavailable': {
    status: 503,
    body: { error: 'PROVIDER_UNAVAILABLE', retryable: true, message: 'Internal error' },
  },
  '/rate-limited': {
    status: 429,
    body: { error: 'RATE_LIMITED', retryable: true, message: 'Internal error' },
  },
  '/recipient-rejected': {
    status: 422,
    body: {
      error: 'RECIPIENT_REJECTED',
      retryable: false,
      message: "The recipient email address couldn't be reached. Please check the address.",
    },
  },
  '/persist-unavailable': {
    status: 503,
    body: { error: 'PERSIST_UNAVAILABLE', retryable: true, message: 'Internal error' },
  },
  '/blocked': {
    status: 400,
    body: {
      error: 'BLOCKED',
      retryable: false,
      message: "This webhook URL isn't allowed for security reasons. Please use a public, secure URL.",
    },
  },
  '/endpoint-rejected': {
    status: 400,
    body: {
      error: 'ENDPOINT_REJECTED',
      retryable: false,
      message: 'The webhook endpoint refused the request. Please check your endpoint configuration.',
    },
  },
  '/endpoint-unavailable': {
    status: 502,
    body: {
      error: 'ENDPOINT_UNAVAILABLE',
      retryable: true,
      message: 'The webhook endpoint is unreachable. Please check your endpoint configuration.',
    },
  },
  '/timeout': {
    status: 504,
    body: { error: 'TIMEOUT', retryable: true, message: 'Internal error' },
  },
  '/endpoint-rate-limited': {
    status: 429,
    body: { error: 'ENDPOINT_RATE_LIMITED', retryable: true, message: 'Internal error' },
  },
};

const PORT = process.env.PORT || 3000;

// Plain in-memory counter — this works reliably here because this script
// runs as one continuously-running process (unlike Postman's coded mock,
// which appears to run each request as a short-lived, stateless
// invocation, so its pm.state persistence doesn't survive between calls).
let retryAttempts = 0;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (path === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ routes: [...Object.keys(routes), '/retry-then-succeed', '/retry-then-succeed/reset'] }, null, 2));
    return;
  }

  // Fails (503, retryable) on attempts 1 and 2, succeeds (200) on attempt 3,
  // then the cycle repeats. Use this to confirm your system produces no
  // error row / no user-facing failure when retries 1-2 fail but retry 3
  // succeeds.
  if (path === '/retry-then-succeed') {
    retryAttempts += 1;
    const position = ((retryAttempts - 1) % 3) + 1; // cycles 1, 2, 3, 1, 2, 3, ...
    res.writeHead(position < 3 ? 503 : 200, { 'Content-Type': 'application/json' });
    if (position < 3) {
      res.end(JSON.stringify({ error: 'PROVIDER_UNAVAILABLE', retryable: true, message: 'Internal error', attempt: position }));
    } else {
      res.end(JSON.stringify({ status: 'delivered', attempt: position }));
    }
    return;
  }

  // Restarts the retry-then-succeed count from 1 before a clean test run.
  if (path === '/retry-then-succeed/reset') {
    retryAttempts = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ reset: true }));
    return;
  }

  const route = routes[path];
  if (!route) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'NOT_FOUND', message: `No mock defined for ${path}` }));
    return;
  }

  // /timeout?hang=true never responds, so you can test your OWN client-side
  // timeout/retry logic rather than just receiving a 504 immediately.
  if (path === '/timeout' && url.searchParams.get('hang') === 'true') {
    return;
  }

  res.writeHead(route.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(route.body, null, 2));
});

server.listen(PORT, () => {
  console.log(`Mock webhook responder listening on http://localhost:${PORT}`);
  console.log('Available routes:');
  Object.keys(routes).forEach((r) => console.log(`  ${r} -> ${routes[r].status}`));
});