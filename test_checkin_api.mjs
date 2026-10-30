import handler from './api/checkin.js';

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, val) { this.headers[key] = val; return this; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    end() { return this; }
  };
  return res;
}

async function runTests() {
  let passed = 0;
  let total = 0;

  function assert(desc, condition) {
    total++;
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
    }
  }

  // Test 1: Missing Env Vars on GET
  delete process.env.TFB_APPS_SCRIPT_URL;
  delete process.env.TFB_API_SECRET;
  const res1 = createMockRes();
  await handler({ method: 'GET', headers: {} }, res1);
  assert('GET without env returns 500', res1.statusCode === 500 && res1.body.ok === false);

  // Test 2: Invalid Method PUT
  const res2 = createMockRes();
  await handler({ method: 'PUT', headers: {} }, res2);
  assert('PUT returns 405 Method Not Allowed', res2.statusCode === 405);

  // Test 3: Disallowed Origin on POST
  process.env.TFB_ALLOWED_ORIGIN = 'https://qr-scanner-kappa-indol.vercel.app';
  const res3 = createMockRes();
  await handler({
    method: 'POST',
    headers: { origin: 'https://malicious-site.com' },
    body: { action: 'checkin', token: 'test', pin: '123' }
  }, res3);
  assert('Disallowed Origin returns 403 Forbidden', res3.statusCode === 403 && res3.body.code === 'FORBIDDEN_ORIGIN');

  // Test 4: Missing Action on POST
  const res4 = createMockRes();
  await handler({
    method: 'POST',
    headers: { origin: 'https://qr-scanner-kappa-indol.vercel.app' },
    body: { token: 'test', pin: '123' }
  }, res4);
  assert('Missing action returns 400', res4.statusCode === 400 && res4.body.code === 'INVALID_ACTION');

  // Test 5: Missing Token on POST
  const res5 = createMockRes();
  await handler({
    method: 'POST',
    headers: { origin: 'https://qr-scanner-kappa-indol.vercel.app' },
    body: { action: 'checkin', token: '', pin: '123' }
  }, res5);
  assert('Missing token returns 400', res5.statusCode === 400 && res5.body.code === 'INVALID_TOKEN');

  // Test 6: Missing PIN on POST
  const res6 = createMockRes();
  await handler({
    method: 'POST',
    headers: { origin: 'https://qr-scanner-kappa-indol.vercel.app' },
    body: { action: 'checkin', token: 'TFB-TOKEN-001', pin: '' }
  }, res6);
  assert('Missing pin returns 401 Auth Failed', res6.statusCode === 401 && res6.body.code === 'AUTH_FAILED');

  // Test 7: Missing Server Secret on valid body
  const res7 = createMockRes();
  await handler({
    method: 'POST',
    headers: { origin: 'https://qr-scanner-kappa-indol.vercel.app' },
    body: { action: 'checkin', token: 'TFB-TOKEN-001', pin: '1234567890123456' }
  }, res7);
  assert('Missing upstream env returns 500 Config Error', res7.statusCode === 500 && res7.body.code === 'CONFIG_ERROR');

  console.log(`\nTests Completed: ${passed}/${total} passed.`);
}

runTests();
