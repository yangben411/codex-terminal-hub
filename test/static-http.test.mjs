import test from "node:test";
import assert from "node:assert/strict";
import { acceptsGzip, matchesEtag } from "../static-http.mjs";
test("gzip negotiation honors explicit exclusions and wildcard", () => {
  for (const value of ["gzip, deflate, br", "GZip; q=0.5", "*"]) assert.equal(acceptsGzip(value), true);
  for (const value of ["", "br", "gzip;q=0, *;q=1", "gzip;q=bad", "gzip;q=2"]) assert.equal(acceptsGzip(value), false);
});
test("weak ETag revalidation matches lists and wildcard but not changed files", () => {
  assert.equal(matchesEtag('"other", "abc"', 'W/"abc"'), true);
  assert.equal(matchesEtag('*', 'W/"abc"'), true);
  assert.equal(matchesEtag('W/"old"', 'W/"abc"'), false);
  assert.equal(matchesEtag(undefined, 'W/"abc"'), false);
});
