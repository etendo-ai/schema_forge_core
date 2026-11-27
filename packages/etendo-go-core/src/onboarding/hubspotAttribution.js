/**
 * ETP-6363 — lead attribution: what HubSpot needs to tie a sign-up to the visits that led to it.
 *
 * HubSpot's tracking code (loaded by GTM, only with the visitor's consent) leaves the
 * `hubspotutk` cookie on the `etendo.ai` domain, so the app reads it even when the website set it.
 * The register and single sign-on requests carry it to the backend, which keeps it with the new
 * account and sends it to HubSpot's Forms API once the address is confirmed.
 *
 * The campaign parameters (`utm_*`, `gclid`…) are only in the address the visitor landed on, and
 * the app's redirect to `/onboarding` drops them: the app keeps that landing page on its first load
 * ({@link captureLandingAttribution}) and the sign-up sends it as the page.
 *
 * Nothing here may block a sign-up: a visitor who refused the cookies has no `hubspotutk`, and the
 * account is created all the same, only without attribution.
 */

/** A `hubspotutk` value: HubSpot writes 32 hex characters. */
const HUTK_PATTERN = /^[a-f0-9]{32}$/i;

/**
 * Query parameters kept in `pageUri`: the campaign ones HubSpot attributes the lead to. Any other
 * is dropped, so a token in the address (a login link, an invitation) never leaves the app.
 */
const ATTRIBUTION_PARAMS = new Set(['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'li_fat_id', 'ttclid']);
const ATTRIBUTION_PREFIXES = ['utm_', 'hsa_'];

const MAX_PAGE_URI = 2000;
const MAX_PAGE_NAME = 255;

function isAttributionParam(name) {
  const key = name.toLowerCase();
  return ATTRIBUTION_PARAMS.has(key) || ATTRIBUTION_PREFIXES.some(prefix => key.startsWith(prefix));
}

/**
 * Reads one cookie.
 *
 * @param {string} cookieString `document.cookie`
 * @param {string} name the cookie
 * @returns {string|null} its value, or null when absent or unreadable
 */
export function readCookie(cookieString, name) {
  if (typeof cookieString !== 'string' || !cookieString) return null;
  for (const part of cookieString.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The page address HubSpot records with the sign-up, without anything but its campaign
 * parameters.
 *
 * @param {string} href the current address
 * @returns {string|null}
 */
export function attributionPageUri(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const kept = new URLSearchParams();
  url.searchParams.forEach((value, key) => {
    if (isAttributionParam(key)) kept.append(key, value);
  });
  const query = kept.toString();
  const uri = `${url.origin}${url.pathname}${query ? `?${query}` : ''}`;
  return uri.length > MAX_PAGE_URI ? `${url.origin}${url.pathname}`.slice(0, MAX_PAGE_URI) : uri;
}

/** Where the landing page of the tab's first visit with campaign parameters is kept. */
export const LANDING_STORAGE_KEY = 'etendo_attr';

function sessionStorageOf(win) {
  try {
    return win?.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function hasAttributionParams(href) {
  try {
    return [...new URL(href).searchParams.keys()].some(isAttributionParam);
  } catch {
    return false;
  }
}

/**
 * Keeps the page the visitor landed on when it carries campaign parameters, before the app
 * redirects (`/` to `/onboarding`) and the address loses them. Call it once, before the router
 * mounts. Only the first one of the tab is kept, and only as {@link attributionPageUri} leaves it:
 * no personal data and no token. `sessionStorage` survives a single sign-on, which returns to the
 * same tab.
 *
 * @param {Window} [win] the browser's, by default
 * @returns {boolean} whether a landing page was stored
 */
export function captureLandingAttribution(win = typeof window === 'undefined' ? null : window) {
  const storage = sessionStorageOf(win);
  const href = win?.location?.href;
  if (!storage || !href || !hasAttributionParams(href)) return false;
  try {
    if (storage.getItem(LANDING_STORAGE_KEY)) return false;
    const landing = attributionPageUri(href);
    if (!landing) return false;
    storage.setItem(LANDING_STORAGE_KEY, JSON.stringify({ landing }));
    return true;
  } catch {
    return false;
  }
}

/**
 * The landing page {@link captureLandingAttribution} kept, if any.
 *
 * @param {Window} [win] the browser's, by default
 * @returns {string|null}
 */
export function storedLandingPage(win = typeof window === 'undefined' ? null : window) {
  const storage = sessionStorageOf(win);
  if (!storage) return null;
  try {
    const landing = JSON.parse(storage.getItem(LANDING_STORAGE_KEY) || 'null')?.landing;
    return typeof landing === 'string' ? attributionPageUri(landing) : null;
  } catch {
    return null;
  }
}

/**
 * What the register and single sign-on requests send as `hubspotContext`. The page is the landing
 * page kept on the first load when there is one, so the campaign parameters the redirect dropped
 * still reach HubSpot; the current address otherwise.
 *
 * @param {{ cookie?: string, href?: string, title?: string, landing?: string|null }} [source] the
 *   browser's, by default
 * @returns {{ hutk?: string, pageUri?: string, pageName?: string }|null} null when there is
 *   nothing to send (no browser)
 */
export function readHubSpotContext(source) {
  const doc = typeof document === 'undefined' ? null : document;
  const win = typeof window === 'undefined' ? null : window;
  const cookie = source?.cookie ?? doc?.cookie ?? '';
  const href = source?.href ?? win?.location?.href ?? '';
  const title = source?.title ?? doc?.title ?? '';
  const landing = source && 'landing' in source ? source.landing : storedLandingPage(win);
  const context = {};
  const hutk = readCookie(cookie, 'hubspotutk');
  if (hutk && HUTK_PATTERN.test(hutk)) context.hutk = hutk.toLowerCase();
  const pageUri = landing || (href ? attributionPageUri(href) : null);
  if (pageUri) context.pageUri = pageUri;
  const pageName = typeof title === 'string' ? title.trim().slice(0, MAX_PAGE_NAME) : '';
  if (pageName) context.pageName = pageName;
  return Object.keys(context).length ? context : null;
}
