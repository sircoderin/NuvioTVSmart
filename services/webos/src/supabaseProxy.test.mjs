import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { runSupabaseProxyRequest } = require("./supabaseProxy.js");

const run = (payload) => new Promise((resolve) => runSupabaseProxyRequest(payload, resolve));

test("in-process proxy keeps the target allowlist", async () => {
  const result = await run({ url: "https://example.com/rest/v1/rpc/x", method: "POST" });
  assert.equal(result.statusCode, 403);
});

test("in-process proxy keeps the request size limit", async () => {
  const result = await run({
    url: "https://api.nuvio.tv/rest/v1/rpc/x",
    method: "POST",
    body: "x".repeat(2 * 1024 * 1024 + 1)
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body, "Proxy request body too large");
});
