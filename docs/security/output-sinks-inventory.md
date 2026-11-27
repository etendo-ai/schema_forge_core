# Output sink inventory (ETP-4561, SECURITY 7/7)

Covers `schema_forge_core`, `schema_forge` and `modules/com.etendoerp.go`. Result legend:
**Vulnerable (fixed)**, **Safe** (characterized, test kept as regression), **Safe by inspection** (no test, reason given), **Unverified** (follow-up).

Follow-up tickets are opened under epic ETP-3504 by the delivery owner. **Before merge, the PR author must replace these placeholders with the real ETP keys (and say so in the PR description):** `FU-PDF`, `FU-EMAIL`, `FU-CLASSIC` (below), each owned by the repo/team that owns the area: `FU-PDF` report-server/jsreport owner (schema_forge_core), `FU-EMAIL` transactional email owner (com.etendoerp.go), `FU-CLASSIC` classic-integrations owner (com.etendoerp.go).

## schema_forge_core

| # | Source | Untrusted origin | Sink | Context | Defense | Test | Result | Owner |
|---|--------|------------------|------|---------|---------|------|--------|---|
| 1 | app-shell-core React views (e.g. `DistinctValuesList`) | API/DB record text | JSX text / attributes | HTML text, attribute | React default escaping | `components/contract-ui/__tests__/outputEscaping.vitest.jsx`; grid cell, form field and record title in schema_forge: `contract-ui/__tests__/output-escaping.vitest.jsx` | Safe; no `dangerouslySetInnerHTML`, `innerHTML`, `document.write` in this repo | schema_forge_core (app-shell-core) |
| 2 | `pages/AuthorizePage.jsx` Deny | `redirect_uri` query param | `location.href` | URL | `parseSafeUrl` + URLSearchParams for `error`/`state` | `AuthorizePage.vitest.jsx` (ETP-4561 block) | **Vulnerable (fixed)**: `javascript:` ran on Deny; unsafe URI now shows "Invalid redirect URL received" | schema_forge_core (app-shell-core) |
| 3 | `pages/AuthorizePage.jsx` Authorize | `redirect_url` API response | `location.href` | URL | `parseSafeUrl` | same | Defense in depth (fixed) | schema_forge_core (app-shell-core) |
| 4 | `AuthorizePage` InstallButton | literals from `lib/mcpClients.js` | `location.href` | URL | trusted constants | mcpClients tests | Safe | schema_forge_core (app-shell-core) |
| 5 | `reports/ReportViewerFrame.jsx` | `report.baseUrl` / `params` from `createReportDescriptor` (app-author config via `AppShellRuntime`, no end-user input) | `<iframe src>` | URL | `encodeURIComponent` + `URLSearchParams` | `reports/__tests__/ReportViewerFrame.vitest.js` | Safe: reportId/params cannot change scheme, host or path; only `baseUrl` (trusted config) can. Not wrapped in `parseSafeUrl` because no caller passes untrusted input | schema_forge_core (app-shell-core) |
| 6 | `etendo-go-core` onboarding `location.href = buildAppReturnToHref(...)` (OnboardingFlow, EnvSelectStep, SetupProgressStep) | `returnTo` query param | `location.href` | URL (relative) | `isSafeLocalReturnTo`: must start `/`, no `//`, no `\`, not `/login`/`/onboarding` | existing `etendo-go-core/test` for `oauthReturnTo` | Safe (same-origin path only) | schema_forge_core (app-shell-core) |
| 7 | `templates/reports/document-branding.hbs` | `org_name`, `meta.title` | `alt="{{ }}"` | HTML attribute | Handlebars escaping | `tools/report-server/__tests__/output-sinks-escaping.test.js` | Safe | schema_forge_core (app-shell-core) |
| 8 | report templates `{{{css}}}` | server-built CSS | `<style>` | CSS | trusted value | - | **Safe by inspection**: `{{{css}}}` is the only triple-stash use and its value is built server-side from the report-server theme, never from record data. Deferred without a test: the report-server suite already fails on develop (5 pre-existing failures, see Commands), so a template-scan test is left to `FU-PDF` | schema_forge_core (report-server templates) |
| 9 | `components/import/ImportDialog.jsx` `a.href` | in-memory Blob | download link | URL | `URL.createObjectURL` | `components/import/__tests__/ImportDialog.test.jsx` (anchor href is exactly the app `blob:` URL) | Safe | schema_forge_core (app-shell-core) |

## schema_forge

| # | Source | Untrusted origin | Sink | Context | Defense | Test | Result | Owner |
|---|--------|------------------|------|---------|---------|------|--------|---|
| 10 | `contract-ui/ReportDrawer.jsx` local fallback preview | record values, filter values, column labels, title | `iframe.document.write` and print `window.open` + `document.write` | HTML text (same-origin document) | **was none** → `escapeHtml` (`lib/escapeHtml.js`) | `ReportDrawer.escaping.vitest.jsx` (fails on the old code), `lib/__tests__/escapeHtml.test.js` | **Vulnerable (fixed)**: a record value like `<img onerror>` executed in the app origin when jsreport was down. The jsreport path renders through Handlebars `{{ }}` (see 7) | schema_forge (app-shell SPA) |
| 11 | `support/helpDocs.js` `stripHtml` | help-docs search index text | `div.innerHTML` on a detached node | HTML parse | **was** `innerHTML` (loads `<img>`, fires `onerror`) → inert `DOMParser` | `helpDocs.vitest.js` (fails on the old code: asserts no `innerHTML` assignment) | Hardened (source is the Etendo help site, i.e. semi-trusted) | schema_forge (app-shell SPA) |
| 12 | `reports/reportDocumentUrl.js` → `DynamicDrillPanel` `window.open` | `docWindow`, `recordId`, query key/value from report SQL | `window.open(url)` | URL | fixed `location.origin` prefix, query encoded | `components/reports/dynamic/__tests__/drillDown.vitest.js` (hostile `javascript:`, `//evil`, `../` ids stay on the app origin) | Safe: scheme/host cannot change (path only) | schema_forge (app-shell SPA) |
| 13 | `contract-ui/DocumentPrintDrawer.jsx` `window.open` | `clientUrlRef` (app-created blob URL) / `URL.createObjectURL(pdf)` | `window.open` | URL | app-created blob URLs | `contract-ui/__tests__/DocumentPrintDrawer.vitest.jsx` (hostile document id; `window.open` gets only the blob URL) | Safe | schema_forge (app-shell SPA) |
| 14 | `contract-ui/DocumentPreview.jsx` `<object data>`/`<iframe src>` | `pdfUrl` (blob URL from the app's own PDF fetch) | iframe/object | URL | app-created blob URL | `contract-ui/__tests__/DocumentPreview.vitest.jsx` (hostile title; only the given blob URL reaches `data`/`src`) | Safe | schema_forge (app-shell SPA) |
| 15 | `artifacts/sales-quotation/custom/QuotationConfirmModal.jsx` `location.href` | `route` built in code from record id | `location.href` | URL (path) | `basePath` from `location.pathname`; prefix is same-origin | `windows/custom/sales-quotation/__tests__/QuotationConfirmModal.goToDoc.vitest.jsx` (hostile order id/number) | Safe | schema_forge (app-shell SPA) |

## modules/com.etendoerp.go

| # | Source | Untrusted origin | Sink | Context | Defense | Test | Result | Owner |
|---|--------|------------------|------|---------|---------|------|--------|---|
| 16 | `PisReturnCallbackServlet` `FALLBACK_BODY` inline `<script>` | none: static constant, no interpolation | HTTP response HTML | HTML/JS | constant string; `postMessage` target `'*'` carries only `{type:'pis-completed'}` | `PisReturnCallbackServletFallbackBodyTest.java` (body byte-identical for hostile `payment_id`/`error_class`) | Safe (no untrusted data); the `'*'` target is data-free | com.etendoerp.go (financiero cell) |
| 17 | `SupportAccessMessages.link` / `openInNewTabScript` | support-access URL | `<a href>` and `window.open(JSONObject.quote(url))` | HTML attribute, JS string | `isSafeHttpUrl` allowlist, `escapeHtml`, JSON quoting, `noopener,noreferrer` | `SupportAccessMessagesTest.java` (`acceptsOnlyPlainHttpUrls` already rejects `javascript:` and relative URLs; `linkOpensInANewTabWithoutOpenerAndEscapesItsParts`, `openScriptQuotesTheUrlAsAJavaScriptString`) | Safe | com.etendoerp.go (support-access owner) |

## Out of scope / follow-up
- Rich text: **not supported**. No field renders sanitized rich HTML in the repos searched; no sanitizer is needed or added.
- PDF generation (jsreport/Chrome): out of scope here; owner follow-up `FU-PDF` (must test untrusted fields interpolated into PDF templates).
- Email templates: out of scope; owner follow-up `FU-EMAIL`.
- Classic administration and other integrations: `FU-CLASSIC`.
- CSP / Trusted Types: defense in depth only; not added.
- QA/security review: pending.

## Rules
- `lib/safeUrl.js` (`parseSafeUrl`) is the only navigation URL policy: https by default; rejects `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, `about:`, `filesystem:`, credentials, malformed hosts and protocol-relative URLs; canonicalizes the output.
- Compatibility with ETP-4556 `allowedSchemes` (`lib/validation`): `lib/__tests__/safeUrl-parity.test.js` runs one table through both. Intentional differences: the sink rejects embedded credentials (the validator ignores them), hard-blocks dangerous schemes even with custom schemes, and never accepts protocol-relative URLs. Relative paths are opt-in.
- `http:` is accepted for OAuth `redirect_uri` (not restricted to loopback hosts in the SPA; the server validates the registered `redirect_uri`) so RFC 8252 loopback clients work; app deep links use custom schemes. Anything else (`javascript:`, `data:`, ...) is rejected by `parseSafeUrl`.
- No storage-time sanitization; encode at each sink for its own context (`escapeHtml` for HTML text, `URLSearchParams` for query strings, `parseSafeUrl` for URLs). Never use one for another context.
- New report/generated windows: any `{{{x}}}`, `innerHTML`, `document.write` or data-bound `href`/`src` must be added to this table with a test.

## Commands and results
Run from the worktree on branch `feature/ETP-4561`.

| Command (cwd) | Result |
|---------------|--------|---|
| `npm test` (`schema_forge_core/packages/app-shell-core`) | 2187 tests, 2187 pass, 0 fail |
| `npx vitest run` (same) | 65 files, 1351 tests pass |
| `npm test` (`schema_forge_core` root, cli) | 4007 tests, 4007 pass, 0 fail |
| `node --test tools/report-server/__tests__/*.test.js` (`schema_forge_core`) | 138 tests, 133 pass, 5 fail. The same command on `origin/develop` (detached worktree): 133 tests, 128 pass, the same 5 fail (helper whitelist, i18n groupBy, company-logo, branding partial) — pre-existing, not caused by this change; `output-sinks-escaping.test.js` passes 5/5 |
| `node --test src/lib/__tests__/escapeHtml.test.js` (`schema_forge/tools/app-shell`) | 4 pass |
| `npx vitest run src/components/support/__tests__/helpDocs.vitest.js src/components/contract-ui/__tests__/ReportDrawer src/components/contract-ui/__tests__/output-escaping.vitest.jsx` (same) | all pass (helpDocs 20, output-escaping 16, ReportDrawer suites) |
| `node --test src/lib/__tests__/safeUrl*.test.js` (`schema_forge_core/packages/app-shell-core`) | 64 tests, 64 pass (after splitting `parseSafeUrl` into `parseRelativeUrl` / `isAcceptedUrl`) |
| `npx vitest run src/pages` (same) | 2 files, 46 tests pass (AuthorizePage) |
| `npx vitest run src/components/support/__tests__/helpDocs.vitest.js src/components/contract-ui/__tests__/DocumentPreview.vitest.jsx src/components/contract-ui/__tests__/DocumentPrintDrawer.vitest.jsx src/components/reports/dynamic/__tests__/drillDown.vitest.js src/windows/custom/sales-quotation/__tests__/QuotationConfirmModal.goToDoc.vitest.jsx` (`schema_forge/tools/app-shell`) | 5 files, 81 tests pass |
| `./gradlew --offline goTestUnit --tests '*PisReturnCallbackServletFallbackBodyTest'` (Etendo workspace root, `modules/com.etendoerp.go`) | BUILD SUCCESSFUL, 2 tests pass |
