// Keep the browser and API copies identical: deployments have independent roots.
// Parity is covered by backend/test/passwordPolicy.test.js.
export const PASSWORD_MIN_CHARACTERS = 12;
export const PASSWORD_MAX_CHARACTERS = 128;

const rules = [
  {
    code: 'length',
    label: `Minimum of ${PASSWORD_MIN_CHARACTERS} characters`,
    message: `Use between ${PASSWORD_MIN_CHARACTERS} and ${PASSWORD_MAX_CHARACTERS} characters.`,
    test: password => {
      const length = Array.from(password).length;
      return length >= PASSWORD_MIN_CHARACTERS && length <= PASSWORD_MAX_CHARACTERS;
    },
  },
  {
    code: 'uppercase', label: 'At least 1 uppercase letter',
    message: 'Include at least 1 uppercase letter.',
    test: password => /\p{Lu}/u.test(password),
  },
  {
    code: 'lowercase', label: 'At least 1 lowercase letter',
    message: 'Include at least 1 lowercase letter.',
    test: password => /\p{Ll}/u.test(password),
  },
  {
    code: 'number', label: 'At least 1 number',
    message: 'Include at least 1 number (0–9).',
    test: password => /[0-9]/.test(password),
  },
  {
    code: 'symbol', label: 'At least 1 symbol',
    message: 'Include at least 1 symbol, such as !, @, or #. Spaces do not count as symbols.',
    test: password => /[\p{P}\p{S}]/u.test(password),
  },
];

// The checklist and API errors evaluate exactly the same five requirements.
export function passwordRequirements(password) {
  const value = typeof password === 'string' ? password : '';
  return rules.map(({ code, label, message, test }) => ({ code, label, message, passed: test(value) }));
}

export function passwordIssues(password) {
  return passwordRequirements(password)
    .filter(requirement => !requirement.passed)
    .map(({ code, message }) => ({ code, message }));
}

export function passwordError(password, confirmation) {
  return passwordIssues(password)[0]?.message
    || (confirmation !== undefined && password !== confirmation ? 'Password and confirmation do not match.' : '');
}
