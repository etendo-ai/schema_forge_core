# Output sink inventory (ETP-4561, SECURITY 7/7)

Scope: `schema_forge_core`. Follow-ups for other repos are listed at the end.

| # | Source | Untrusted origin | Sink | Context | Defense | Test | Result |
|---|--------|------------------|------|---------|---------|------|--------|
| 1 | `app-shell-core` React views | any API/DB text | JSX text/attrs | HTML text | React default escaping | n/a (framework) | Safe; no `dangerouslySetInnerHTML`, `innerHTML`, `document.write` in this repo (grep) |
| 2 | `pages/AuthorizePage.jsx` deny | `redirect_uri` query param | `location.href` | URL | **was none** → `parseSafeUrl` | `AuthorizePage.vitest.jsx` (ETP-4561) | **Confirmed vulnerable** (`javascript:` on Deny); fixed |
| 3 | `pages/AuthorizePage.jsx` authorize | `redirect_url` API response | `location.href` | URL | **was none** → `parseSafeUrl` | `AuthorizePage.vitest.jsx` | Defense in depth; fixed |
| 4 | `AuthorizePage` InstallButton | literals from `lib/mcpClients.js` | `location.href` | URL | trusted constants | existing mcpClients tests | Safe (trusted) |
| 5 | `templates/reports/document-branding.hbs` | `org_name`, `meta.title` | `alt="{{ }}"` | HTML attribute | Handlebars `{{ }}` escaping | `tools/report-server/__tests__/output-sinks-escaping.test.js` | Safe |
| 6 | report templates `{{{css}}}` | server-built CSS | `<style>` | CSS | trusted (not user data) | - | Safe by contract; never put user data in a `{{{ }}}` |
| 7 | `ImportDialog.jsx` `a.href` | in-memory Blob | download link | URL | `URL.createObjectURL` | - | Safe |
| 8 | `reports/ReportViewerFrame.jsx` | report-server URL | `<iframe src>` | URL | app-built URL | - | Unverified for hostile input; owner: reports |
| 9 | `etendo-go-core` AuthBrand `brandHref` | app config | `<a href>` | URL | app config | - | Trusted; use `parseSafeUrl` if it ever becomes user-supplied |

## Rules
- `lib/safeUrl.js` (`parseSafeUrl`) is the only URL policy: https by default, rejects `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, credentials, malformed hosts, protocol-relative.
- No storage-time sanitization. Encode at each sink for its own context.
- New report/generated window: any `{{{x}}}` or raw HTML sink must be added to this table with a test.

## Out of scope / follow-up
PDF (jsreport/Chrome) and email templates, `schema_forge` and `com.etendoerp.go` surfaces, classic admin: not in this repo; owners to inventory in their repos. CSP/Trusted Types: defense in depth, not done here. QA/security review: pending.
