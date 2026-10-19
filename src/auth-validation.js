/** @param {string} value */
export function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

/** @param {string} value */
export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

/** @param {string} value */
export function isValidDateOfBirth(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

/** @param {string} value @param {Date} [today] */
export function isAtLeastEighteen(value, today = new Date()) {
  if (!isValidDateOfBirth(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const eighteenthBirthday = Date.UTC(year + 18, month - 1, day);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return eighteenthBirthday <= todayUtc;
}

/**
 * @param {{
 *   displayName?: string;
 *   dateOfBirth?: string;
 *   email?: string;
 *   password?: string;
 *   passwordConfirmation?: string;
 * }} input
 * @returns {{
 *   error?: string;
 *   value?: { displayName: string; dateOfBirth: string; email: string; password: string };
 * }}
 */
export function validateSignup({ displayName, dateOfBirth, email, password, passwordConfirmation }) {
  const normalizedDisplayName = (displayName ?? "").trim();
  const normalizedEmail = normalizeEmail(email ?? "");
  const normalizedDateOfBirth = dateOfBirth ?? "";
  if (!normalizedDisplayName || normalizedDisplayName.length > 80) {
    return { error: "Enter a name of 1 to 80 characters." };
  }
  if (!isValidDateOfBirth(normalizedDateOfBirth)) {
    return { error: "Enter a valid date of birth." };
  }
  if (!isAtLeastEighteen(normalizedDateOfBirth)) {
    return { error: "You must be at least 18 to create an account." };
  }
  if (normalizedEmail.length > 254 || !isValidEmail(normalizedEmail)) {
    return { error: "Enter a valid email address." };
  }
  if (typeof password !== "string" || password.length < 12) {
    return { error: "Choose a password with at least 12 characters." };
  }
  if (password !== passwordConfirmation) {
    return { error: "Your passwords do not match." };
  }
  return { value: { displayName: normalizedDisplayName, dateOfBirth: normalizedDateOfBirth, email: normalizedEmail, password } };
}
