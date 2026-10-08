import assert from "node:assert/strict";
import { after, test } from "node:test";
import { credentialsMatch, hashToken, hasTrustedOrigin, newSessionToken, validSessionToken } from "../src/server/auth-core";

const original = { ADMIN_USERNAME: process.env.ADMIN_USERNAME, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, APP_URL: process.env.APP_URL, NODE_ENV: process.env.NODE_ENV };
after(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("credentials reject unset environment, wrong values and malformed input", () => {
  delete process.env.ADMIN_USERNAME; delete process.env.ADMIN_PASSWORD;
  assert.equal(credentialsMatch("undefined", "undefined"), false);
  process.env.ADMIN_USERNAME = "test-admin"; process.env.ADMIN_PASSWORD = "test-password";
  assert.equal(credentialsMatch("test-admin", "test-password"), true);
  assert.equal(credentialsMatch("test-admin", "wrong"), false);
  assert.equal(credentialsMatch("wrong", "test-password"), false);
  assert.equal(credentialsMatch(null, {}), false);
  assert.equal(credentialsMatch("test-admin", "x".repeat(5000)), false);
});

test("session token is random and rejects legacy credentials and malformed tokens", () => {
  const first = newSessionToken(); const second = newSessionToken();
  assert.equal(validSessionToken(first), true);
  assert.notEqual(first, second);
  assert.notEqual(first, hashToken(first));
  assert.equal(hashToken(first).length, 64);
  assert.equal(validSessionToken(Buffer.from("test-admin:test-password").toString("base64")), false);
  for (const value of [undefined, "", "forged", "a".repeat(42), "a".repeat(44), "!".repeat(43)]) assert.equal(validSessionToken(value), false);
});

test("CSRF origin checks pin the configured public origin behind a proxy", () => {
  process.env.APP_URL = "https://rich.example.com";
  const request = (origin?: string) => new Request("http://localhost:3000/api/members", { method: "PUT", headers: origin === undefined ? {} : { origin } });
  assert.equal(hasTrustedOrigin(request("https://rich.example.com")), true);
  for (const origin of [undefined, "null", "https://evil.example", "https://rich.example.com.evil.example", "http://rich.example.com", "https://rich.example.com:444"]) assert.equal(hasTrustedOrigin(request(origin)), false);
});


test("production rejects state-changing requests without configured APP_URL", () => {
  const oldEnvironment = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "production" });
  delete process.env.APP_URL;
  const request = new Request("https://rich.example.com/api/members", { method: "PUT", headers: { origin: "https://rich.example.com" } });
  assert.equal(hasTrustedOrigin(request), false);
  if (oldEnvironment === undefined) delete process.env["NODE_ENV" as string];
  else Object.assign(process.env, { NODE_ENV: oldEnvironment });
});
