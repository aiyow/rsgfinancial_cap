import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEmailIdentity } from "../services/accounts.js";

test("email identity ignores casing and accidental surrounding spaces", () => {
  assert.equal(normalizeEmailIdentity("  Airon.Magpayo@Example.COM  "), "airon.magpayo@example.com");
  assert.equal(
    normalizeEmailIdentity("airon.magpayo@example.com"),
    normalizeEmailIdentity("AIRON.MAGPAYO@example.com ")
  );
});
