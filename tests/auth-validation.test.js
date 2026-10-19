import test from "node:test";
import assert from "node:assert/strict";
import {
  isAtLeastEighteen,
  isValidDateOfBirth,
  isValidEmail,
  normalizeEmail,
  validateSignup,
} from "../src/auth-validation.js";

const validSignup = {
  displayName: " Sam ",
  dateOfBirth: "1990-06-15",
  email: " SAM@example.com ",
  password: "a-long-example-password",
  passwordConfirmation: "a-long-example-password",
};

test("normalizes email before account creation", () => {
  assert.equal(normalizeEmail("  SAM@Example.COM "), "sam@example.com");
  assert.equal(validateSignup(validSignup).value.email, "sam@example.com");
});

test("rejects malformed emails", () => {
  assert.equal(isValidEmail("no-at-sign"), false);
  assert.equal(validateSignup({ ...validSignup, email: "no-at-sign" }).error, "Enter a valid email address.");
});

test("rejects missing name and required data", () => {
  assert.match(validateSignup({ ...validSignup, displayName: " " }).error, /name/);
  assert.match(validateSignup({ ...validSignup, dateOfBirth: "" }).error, /date of birth/);
  assert.match(validateSignup({ ...validSignup, email: "" }).error, /email/);
  assert.match(validateSignup({ ...validSignup, password: "" }).error, /password/);
});

test("rejects impossible calendar dates", () => {
  assert.equal(isValidDateOfBirth("2000-02-30"), false);
  assert.equal(isValidDateOfBirth("2000-02-29"), true);
});

test("rejects users younger than 18 and accepts the eighteenth birthday", () => {
  const today = new Date("2026-10-16T12:00:00.000Z");
  assert.equal(isAtLeastEighteen("2008-10-17", today), false);
  assert.equal(isAtLeastEighteen("2008-10-16", today), true);
  assert.match(validateSignup({ ...validSignup, dateOfBirth: "2010-01-01" }).error, /18/);
});

test("rejects password mismatch and short passwords", () => {
  assert.match(validateSignup({ ...validSignup, passwordConfirmation: "different-password" }).error, /match/);
  assert.match(validateSignup({ ...validSignup, password: "short", passwordConfirmation: "short" }).error, /12/);
});

test("trims the display name in validated signup data", () => {
  assert.equal(validateSignup(validSignup).value.displayName, "Sam");
});
