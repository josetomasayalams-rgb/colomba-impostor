import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontendUrl, allowedOrigin, bearerMode, sessionToken, corsHeaders, validPreflight } from '../worker/access.mjs';
const api = 'https://api-colomba.example/api/rooms/ABC234';
const env = { FRONTEND_URL: 'https://josetomasayalams-rgb.github.io/colomba-impostor/' };
const req = headers => new Request(api, { headers });
test('CORS permits only the configured GitHub frontend origin and the API itself', () => {
  for (const origin of ['https://josetomasayalams-rgb.github.io', 'https://api-colomba.example']) assert.equal(allowedOrigin(req({ Origin: origin }), env), true);
  for (const origin of ['https://other.github.io', 'https://josetomasayalams-rgb.github.io.attacker.test', 'null', 'http://josetomasayalams-rgb.github.io']) {
    const request = req({ Origin: origin }); assert.equal(allowedOrigin(request, env), false); assert.deepEqual(corsHeaders(request, env), {});
  }
  assert.equal(corsHeaders(req({ Origin: 'https://josetomasayalams-rgb.github.io' }), env)['Access-Control-Allow-Origin'], 'https://josetomasayalams-rgb.github.io');
});
test('invitation URL preserves the project subdirectory and rejects unsafe configuration', () => {
  assert.equal(frontendUrl(env, new URL(api)).href, env.FRONTEND_URL);
  assert.equal(frontendUrl({ FRONTEND_URL: env.FRONTEND_URL.slice(0, -1) }, new URL(api)).href, env.FRONTEND_URL);
  assert.equal(frontendUrl({}, new URL(api)).href, 'https://api-colomba.example/');
  for (const value of ['javascript:alert(1)', 'https://user:password@example.com/', 'http://example.com/', 'https://example.com/?token=x']) assert.throws(() => frontendUrl({ FRONTEND_URL: value }, new URL(api)));
});
test('token delivery requires an allowed origin and explicit bearer mode', () => {
  assert.equal(bearerMode(req({ Origin: 'https://josetomasayalams-rgb.github.io', 'X-Colomba-Session': 'token' }), env), true);
  assert.equal(bearerMode(req({ Origin: 'https://attacker.test', 'X-Colomba-Session': 'token' }), env), false);
  assert.equal(bearerMode(req({ 'X-Colomba-Session': 'token' }), env), false);
  assert.equal(bearerMode(req({ Origin: 'https://josetomasayalams-rgb.github.io' }), env), false);
});
test('invalid bearer credentials do not fall back to ambient cookies', () => {
  const token = 'a'.repeat(64);
  assert.equal(sessionToken(req({ Authorization: `Bearer ${token}` }), 'ABC234'), token);
  assert.equal(sessionToken(req({ Cookie: `colomba_ABC234=${token}` }), 'ABC234'), token);
  assert.equal(sessionToken(req({ Authorization: 'Bearer invalid', Cookie: `colomba_ABC234=${token}` }), 'ABC234'), undefined);
  assert.equal(sessionToken(req({ Cookie: `colomba_OTHER2=${token}` }), 'ABC234'), undefined);
});
test('preflight allows the game methods and headers and rejects arbitrary ones', () => {
  assert.equal(validPreflight(req({ 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type, x-colomba-session, x-csrf-token, x-colomba-intent' })), true);
  assert.equal(validPreflight(req({ 'Access-Control-Request-Method': 'DELETE' })), false);
  assert.equal(validPreflight(req({ 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-admin-secret' })), false);
});
