/**
 * URL sink policy (ETP-4561). Use ONLY for values that become a navigable URL
 * (`location.href`, `window.open`, `<a href>`, `<iframe src>`). It is not an HTML,
 * attribute or CSV encoder: encode those at their own sink. Never applied at
 * storage time — callers pass the stored value through it right before navigating.
 *
 * Untrusted origins: query-string params (redirect_uri), API response fields,
 * user-entered link fields. Trusted: literals built in this repo (mcpClients deep links).
 */

const DEFAULT_PROTOCOLS = ['https:'];

// Schemes that execute script or expose local/in-memory content; never navigable.
const DANGEROUS_PROTOCOLS = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:', 'filesystem:']);

// Same trimming the URL parser applies: leading/trailing C0 controls and space.
// eslint-disable-next-line no-control-regex
const EDGE_JUNK = /^[\u0000- ]+|[\u0000- ]+$/g;

/**
 * Path-only branch. `//host` and `/\host` are protocol-relative, i.e. external.
 * @param {string} raw trimmed input starting with `/` or `\`.
 * @param {boolean} allowRelative whether same-origin paths are accepted at all.
 * @returns {string|null} canonical path + query + hash, or null.
 */
function parseRelativeUrl(raw, allowRelative) {
  // eslint-disable-next-line no-control-regex
  if (!allowRelative || /^[/\\]{2}/.test(raw) || /[\u0000-\u001f]/.test(raw)) return null;
  try {
    const url = new URL(raw, 'https://relative.invalid');
    return url.origin === 'https://relative.invalid' ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
}

/**
 * Policy checks on an absolute, already parsed URL.
 * @param {URL} url
 * @param {{allowedProtocols: string[], allowCustomSchemes: boolean, allowCredentials: boolean}} policy
 * @returns {boolean}
 */
function isAcceptedUrl(url, { allowedProtocols, allowCustomSchemes, allowCredentials }) {
  const protocol = url.protocol.toLowerCase();
  if (DANGEROUS_PROTOCOLS.has(protocol)) return false;
  if (!allowedProtocols.includes(protocol) && !allowCustomSchemes) return false;
  if (!allowCredentials && (url.username || url.password)) return false;
  const isWeb = protocol === 'http:' || protocol === 'https:';
  return !isWeb || Boolean(url.hostname);
}

/**
 * Parse and canonicalize an untrusted URL against an explicit policy.
 *
 * @param {unknown} input
 * @param {object} [options]
 * @param {string[]} [options.allowedProtocols] lowercase with colon; default ['https:'].
 * @param {boolean} [options.allowCustomSchemes] also accept app deep-link schemes
 *        (e.g. `cursor:`), still excluding the dangerous set. For OAuth redirect_uri only.
 * @param {boolean} [options.allowRelative] accept same-origin paths (`/x`, never `//host`).
 * @param {boolean} [options.allowCredentials] accept `user:pass@host` (default false).
 * @returns {string|null} canonical href, or null when the policy rejects it.
 */
export function parseSafeUrl(input, options = {}) {
  const {
    allowedProtocols = DEFAULT_PROTOCOLS,
    allowCustomSchemes = false,
    allowRelative = false,
    allowCredentials = false,
  } = options;
  if (typeof input !== 'string') return null;
  const raw = input.replace(EDGE_JUNK, '');
  if (!raw) return null;

  if (/^[/\\]/.test(raw)) return parseRelativeUrl(raw, allowRelative);

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null; // malformed, or a scheme-less value (encoded scheme, bare host)
  }
  return isAcceptedUrl(url, { allowedProtocols, allowCustomSchemes, allowCredentials }) ? url.href : null;
}

/**
 * Boolean form of {@link parseSafeUrl}.
 *
 * @param {unknown} input the untrusted URL.
 * @param {object} [options] same policy options as `parseSafeUrl`.
 * @returns {boolean} true when the policy accepts the URL.
 */
export function isSafeUrl(input, options) {
  return parseSafeUrl(input, options) !== null;
}
