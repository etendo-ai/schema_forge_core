import { isInvalidImportNumber } from './parseImportNumber.js';
import { isInvalidPhone } from './normalizePhone.js';

import { validateRecord, inferFormatConstraints, describeValidationError } from '../validation/index.js';

function isBlank(value) {
  return value == null || String(value).trim() === '';
}

/**
 * English fallbacks for the row-level validation messages. Used verbatim only when the
 * caller injects no `translate` — the same posture `importEngine.js` takes for backend
 * errors. Keys match the genericLabels keys the functional app defines, so an injected
 * `translate` (useUI's `ui`) resolves them to the session language.
 *
 * These messages reach the user directly in the review queue, so leaving them hardcoded
 * in English was a real i18n hole in a product used primarily in Spanish.
 */
const VALIDATION_FALLBACKS = {
  importErrorRequiredGeneric: () => 'Required field is missing.',
  importErrorInvalidEmail: () => 'Not a valid email address.',
  importErrorInvalidPhone: () => 'The phone number can only contain digits and the + ( ) - . characters, up to 15 characters.',
  importErrorNotANumber: (p) => `"${p.value}" is not a valid number. Use 1234.56 or 1,234.56.`,
  // ETP-4557 — same keys the forms and inline grids use for the same engine codes, so a value
  // reads identically in every flow.
  fieldMaxLengthError: (p) => `Maximum length is ${p.maxLength} characters`,
  fieldMinLengthError: (p) => `Minimum length is ${p.minLength} characters`,
  fieldMinValueError: (p) => `Value must be at least ${p.min}`,
  fieldMaxValueError: (p) => `Value must be at most ${p.max}`,
  fieldInvalidValue: () => 'The value is not valid.',
  websiteInsecureUrl: () => 'Enter a valid secure URL.',
  importErrorFkUnmatched: (p) => `"${p.value}" could not be matched to an existing record.`,
};

function message(key, params, translate) {
  const fallback = VALIDATION_FALLBACKS[key](params ?? {});
  if (typeof translate !== 'function') return fallback;
  const translated = translate(key, params);
  return translated && translated !== key ? translated : fallback;
}

const IMPORT_KEY_OVERRIDES = {
  sendModalInvalidEmail: 'importErrorInvalidEmail',
  phoneInvalidChars: 'importErrorInvalidPhone',
};

// Engine error → localized message through the shared mapper (same keys as form and grid).
function constraintMessage(error, translate) {
  const described = describeValidationError(error);
  // Same code, same decision as the form; only the wording of two keys stays import-specific
  // (already translated in every locale and referenced by the review queue's tests).
  const key = IMPORT_KEY_OVERRIDES[described.key] ?? described.key;
  return message(key, described.params, translate);
}

/**
 * Email format and any declared per-target `validation` (maxLength, minimum, ...) decided by the
 * shared declarative engine. Extracted from `validateRow` to keep its complexity bounded.
 */
function collectConstraintErrors(row, { emailTargets, phoneTargets, fieldConstraints, fieldIdentities, translate }) {
  const errors = [];
  // ETP-4557: email format and any declared per-target `validation` (maxLength, minimum, …)
  // are decided by the shared declarative engine, never by a flow-local regex. `required` stays
  // above (blank-cell semantics shared with the review queue). Empty values are valid.
  // `fieldIdentities` carries `{ column, type }` per target so import infers email/website/phone
  // from the field name exactly like the form and grid adapter do (compat inference, TEMPORARY
  // until contracts declare `format`). An explicit declared constraint always wins.
  const constraintTargets = new Set([
    ...emailTargets, ...Object.keys(fieldConstraints), ...Object.keys(fieldIdentities),
  ]);
  const fields = [...constraintTargets].map((target) => {
    const { required: _required, ...declared } = fieldConstraints[target] ?? {};
    const identity = { key: target, ...(fieldIdentities[target] ?? {}) };
    // phoneTargets keep their own normalising check (one error per problem): no inference there.
    const inferred = target in fieldIdentities && !phoneTargets.includes(target) ? inferFormatConstraints(identity) : null;
    const base = emailTargets.includes(target) ? { format: 'email' } : (inferred ?? {});
    return { name: target, validation: { ...base, ...declared } };
  });
  // A website cell is a bare host ("acme.com") and the descriptor adds the scheme before sending,
  // exactly like the form's `inputPrefix`: prepend it here so the engine `url` rule decides.
  const values = { ...row };
  for (const field of fields) {
    const { format, allowedSchemes } = field.validation;
    const cell = row[field.name];
    if (format === 'url' && !isBlank(cell) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(String(cell).trim())) {
      values[field.name] = `${allowedSchemes?.[0] ?? 'https'}://${String(cell).trim()}`;
    }
  }
  const result = validateRecord({ fields, values, operation: 'update' });
  for (const field of fields) {
    for (const error of result.errors[field.name] ?? []) {
      errors.push({ target: field.name, code: error.code, message: constraintMessage(error, translate) });
    }
  }
  return errors;
}

/**
 * Validate a single row against a window's required fields, email-format
 * fields, numeric fields, and already-resolved foreign-key columns. Pure and
 * single-row so the same function powers both the bulk pre-send pass and the
 * review queue's inline "re-validate after edit" action.
 *
 * `numericTargets` exists so a malformed amount is caught HERE, in the review queue,
 * instead of at operation-build time: a price cell reading "abc" used to sit in the
 * Correctas tab until the user confirmed the import, and only then failed the row.
 * A blank numeric cell is valid — see `parseImportNumber`.
 */
export function validateRow(row, {
  requiredTargets = [],
  emailTargets = [],
  numericTargets = [],
  phoneTargets = [],
  fieldConstraints = {},
  fieldIdentities = {},
  fkTargets = [],
  fkResolutions = new Map(),
  extraErrors = [],
  translate,
} = {}) {
  const errors = [];

  for (const target of requiredTargets) {
    if (isBlank(row[target])) {
      errors.push({ target, message: message('importErrorRequiredGeneric', {}, translate) });
    }
  }

  errors.push(...collectConstraintErrors(row, { emailTargets, phoneTargets, fieldConstraints, fieldIdentities, translate }));

  for (const target of phoneTargets) {
    if (isInvalidPhone(row[target])) {
      errors.push({ target, message: message('importErrorInvalidPhone', {}, translate) });
    }
  }

  for (const target of numericTargets) {
    const value = row[target];
    if (isInvalidImportNumber(value)) {
      errors.push({ target, message: message('importErrorNotANumber', { value }, translate) });
    }
  }

  for (const target of fkTargets) {
    const value = row[target];
    if (isBlank(value)) continue;
    const resolution = fkResolutions.get(target)?.get(String(value).trim());
    if (!resolution || resolution.status !== 'auto-resolved') {
      // `candidates` (present, possibly empty) is what lets the review queue offer a
      // pick-a-value selector instead of a bare retype-and-hope text field.
      errors.push({
        target,
        message: message('importErrorFkUnmatched', { value }, translate),
        candidates: resolution?.candidates ?? [],
      });
    }
  }

  // Descriptor-supplied errors (AD-coded columns, cross-field rules) come last, so the
  // generic problems a user can fix without domain knowledge are listed first.
  errors.push(...extraErrors);

  return { valid: errors.length === 0, errors };
}

export function validateRows(rows, opts) {
  return rows.map((row) => ({ row, ...validateRow(row, opts) }));
}
