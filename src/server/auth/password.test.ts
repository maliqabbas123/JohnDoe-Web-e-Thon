import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "./password";

test("a password verifies against its own hash", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
});

test("a wrong password does not verify", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery stapler", hash), false);
});

test("the same password hashes differently each time", async () => {
  const [first, second] = await Promise.all([hashPassword("same-password"), hashPassword("same-password")]);
  assert.notEqual(first, second);
});

test("the hash does not contain the password", async () => {
  const hash = await hashPassword("visible-secret");
  assert.equal(hash.includes("visible-secret"), false);
  assert.match(hash, /^scrypt\$32768\$8\$3\$/);
});

test("malformed stored values are rejected, not thrown", async () => {
  for (const stored of ["", "plain", "scrypt$1$2", "bcrypt$1$2$3$a$b", "scrypt$0$8$1$c2FsdA$aGFzaA"]) {
    assert.equal(await verifyPassword("anything", stored), false);
  }
});
