# TFB QR Scanner — Antigravity Context & Implementation Handoff

**Prepared:** 30 October 2026  
**Project:** Trust Fund Babies (TFB) — DDLJ Diwali Sundowner QR Check-In  
**Purpose:** Move camera scanning to Vercel while keeping Google Apps Script as the private spreadsheet-verification backend.

---

## 1. Executive summary

The project should use this architecture:

- **Vercel** hosts the scanner page, browser camera, QR decoding and a same-origin serverless API.
- **Google Apps Script** remains the backend that verifies QR tokens and updates the Google Sheet.
- **Google Sheets** remains the source of truth for attendee registrations, ticket-email status, payment status and check-in state.

The Google Apps Script Web App is not being abandoned. Its HTML Service page is unsuitable for camera access because the Apps Script sandbox prevents the browser camera API from working as required. The `/exec` page rendered without CSS at one point and reported `Camera unavailable`; changing browser permissions will not fix the Apps Script sandbox limitation.

**Do not host the camera UI at Apps Script `/exec`.** Staff should use the Vercel URL. Vercel must call the Apps Script `doPost()` endpoint server-to-server.

## 2. Live project locations

### GitHub
- Repository: https://github.com/trustfbabies-creator/qr-scanner
- Branch: `main`
- Local workspace shown in Antigravity terminal:
  `C:\Users\intel\OneDrive\Documents\QR-Scanner\qr-scanner`

### Vercel
- Project name: `qr-scanner`
- Production URL: https://qr-scanner-kappa-indol.vercel.app/
- Production API path to add: `/api/checkin`

### Google Sheets
- Spreadsheet:
  https://docs.google.com/spreadsheets/d/1O470qOtODcH8RYLUJ0AdCbtv7VMoY5I71VNAgoHQBOk/edit
- Spreadsheet ID (letter O after the 1; copy carefully):
  `1O470qOtODcH8RYLUJ0AdCbtv7VMoY5I71VNAgoHQBOk`
- Response tab: `Form Responses 1`
- Apps Script Web App deployment URL:
  `https://script.google.com/macros/s/AKfycbzDIHHX3JCxoXyldvhtICkvW-pJOK1st7hmspr4E4bTKGAC84WtjQSX7GvCRhg-RPTC/exec`
- Apps Script owner/sender account: `trustfbabies@gmail.com`

**Do not print private keys, PINs or API secrets into source files, logs, screenshots, browser JS or this handoff.**

## 3. Verified repository state

I inspected the current GitHub `main` branch at the time this handoff was prepared.

The repository tree contains only:
- `Code.gs`
- `index.html`

It currently does **not** contain:
- `api/checkin.js`
- `script.js`
- `style.css`
- `package.json`
- `vercel.json`

The scanner page has its CSS and JavaScript embedded in `index.html`. Preserve this structure unless there is a clear technical reason to split it. Do not assume the earlier separate `script.js` and `style.css` files exist on `main`.

### Current relevant frontend behaviour

The embedded JavaScript in `index.html` has:
- `hasAppsScriptBridge()` which checks `window.google.script.run`.
- `callCheckInBackend()` which invokes `google.script.run.checkInTicket(token, pin)`.
- `startScanner()` currently exits early when `google.script.run` is unavailable.

That is why the Vercel page does not start the camera. Vercel is not an Apps Script HTML Service page and will never provide `google.script.run`.

### Required frontend correction

- Remove all reliance on `window.google.script.run` from the Vercel browser code.
- The Vercel browser should call `fetch('/api/checkin', ...)`.
- **Do not make camera startup depend on backend connectivity.** `Start camera` should initialize `Html5Qrcode` on the HTTPS Vercel origin even if the backend is temporarily unavailable. A decoded QR is not accepted until the API validates it.
- Keep the existing HTML structure, CSS, design, layout, branding, DOM IDs and responsive behaviour.
- The existing single-page design uses `Html5Qrcode` loaded from:
  `https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js`

## 4. Google Apps Script backend — already present

The current `Code.gs` in GitHub already contains the core backend work. Do not replace it wholesale.

### Confirmed configuration in `Code.gs`

```javascript
const SPREADSHEET_ID = '1O470qOtODcH8RYLUJ0AdCbtv7VMoY5I71VNAgoHQBOk';

const CFG = {
  SHEET_NAME: 'Form Responses 1',
  NAME_HEADER: 'FULL NAME',
  EMAIL_HEADER: 'EMAIL ADDRESS',
  TICKET_ID_HEADER: 'QR TICKET ID',
  TOKEN_HEADER: 'QR TOKEN',
  EMAIL_STATUS_HEADER: 'TICKET EMAIL STATUS',
  CHECKIN_STATUS_HEADER: 'CHECK-IN STATUS',
  CHECKIN_TIME_HEADER: 'CHECK-IN TIME',
  PAYMENT_STATUS_HEADER: 'PAYMENT STATUS',
  TRANSACTION_HEADER: 'UTR / TRANSACTION ID'
};
```

Event values currently in `Code.gs`:
- Event: `DDLJ Diwali Sundowner`
- Date: `01 November 2026`
- Venue: `Arunodaya Farms`
- Entry time: `5:00 PM onwards`
- Pass price: `₹999 per person`
- Instagram: `@trustfbabies`
- Instagram URL: `https://www.instagram.com/trustfbabies/`

### Existing Apps Script API contract

`Code.gs` already includes:
- `doGet(e)` with `?action=health` returning JSON service status.
- `doPost(e)` which parses JSON and expects:
  - `sharedSecret` (or compatibility field `apiSecret`)
  - `action: "checkin"`
  - `token`
  - `pin`
- It reads `TFB_API_SECRET` from Apps Script Script Properties.
- If secret matches and action is `checkin`, it calls:
  `checkInTicket(data.token, data.pin)`
- `jsonResponse_()` returns JSON through Apps Script Content Service.
- `checkInTicket(token, pin)` authenticates staff using Script Property `CHECKIN_PIN`, checks registration/test ticket, prevents duplicate check-ins using `LockService`, and writes check-in status/time.

**Keep the request contract aligned.** Vercel must send `sharedSecret` inside the server-to-server JSON body; the secret must be read only from Vercel environment variables, never from the browser request.

### Existing validation logic in `checkInTicket()`

For real attendee tickets:
1. Find exact QR token in the response sheet's `QR TOKEN` column.
2. Require `TICKET EMAIL STATUS` to equal `SENT`.
3. Require `PAYMENT STATUS` to equal `CONFIRMED`.
4. Reject if already `CHECKED IN`.
5. Otherwise write `CHECKED IN` and `CHECK-IN TIME`.

The check-in implementation uses `LockService` to reduce race conditions / duplicate simultaneous scans.

For the Alizar functional test ticket:
- The token is looked up in the isolated `TFB Test Tickets` tab.
- It is not a real attendee registration.
- First scan returns a test success response.
- Second scan returns `ALREADY_USED` with an explicit test-record message.

Pass the Apps Script response code/message through to the UI; do not mark payment-pending, invalid, unauthorised or duplicate tickets as approved.

### Setup state already completed (per user screenshots)

- `setVercelApiSecret()` was run; the dialog confirmed the `TFB_API_SECRET` value was saved in Script Properties.
- `setupQrCheckIn()` completed successfully; the dialog confirmed ticket columns are ready and the automatic form-submission trigger has been created.
- An Apps Script Web App deployment was created. Its `/exec` page is not the camera host; the deployment remains useful as the API backend.
- The user has not yet demonstrated a successful Vercel-to-Apps-Script API request or a complete successful Vercel camera + real backend check-in.

Do not repeatedly run `setupQrCheckIn()` unless an actual error or missing setup is found. It already reported success.

## 5. Google Sheet structure and email-column distinction

The response sheet starts with:
- Column A: `Timestamp`
- Column B: `Email Address` — Google Forms' automatically captured account email
- Column C: `FULL NAME`
- Column D: `EMAIL ADDRESS` — attendee-entered email address
- Column E: `WHASAPP NUMBER` (header spelling as seen in the sheet)
- Column F: `INSTAGRAM USER`
- Column G: `COLLEGE/UNIVERSITY`
- Later columns include payment screenshot, `UTR / TRANSACTION ID`, registration confirmation and system columns added by Apps Script.

For ticket-recipient logic, the intended attendee email is Column D (`EMAIL ADDRESS`), not Column B (`Email Address`). Preserve the existing backend mapping.

## 6. Vercel implementation required

Create a Vercel Node.js serverless function at:

`api/checkin.js`

Use the Vercel Node function format compatible with this repo's current setup (inspect project configuration before choosing CommonJS/ESM). Do not add a framework or dependency unless necessary.

### Environment variables (Vercel → Settings → Environment Variables)

Set for Production (and Preview only if intentionally testing preview deployments):

- `TFB_APPS_SCRIPT_URL`
  - The deployed Apps Script Web App URL ending in `/exec`.
- `TFB_API_SECRET`
  - Must exactly match the value stored in Apps Script Script Properties as `TFB_API_SECRET`.
- `TFB_ALLOWED_ORIGIN`
  - Production origin:
    `https://qr-scanner-kappa-indol.vercel.app`

The Apps Script shared secret must remain server-side. Never put `TFB_API_SECRET` in `index.html`, inline JS, client bundles, query strings or GitHub commits.

### API contract exposed to the browser

Browser calls same-origin endpoint:
`POST /api/checkin`

Browser JSON body:
```json
{
  "action": "checkin",
  "token": "raw-token-decoded-from-the-QR",
  "pin": "staff access code"
}
```

The browser must **not** send `sharedSecret`.

Vercel function:
1. Allow only expected methods.
2. Validate `Origin` against `TFB_ALLOWED_ORIGIN` when Origin is present; reject unexpected browser origins.
3. Validate `action`, token and pin, enforce sensible body size limits.
4. Read `TFB_APPS_SCRIPT_URL` and `TFB_API_SECRET` from `process.env`.
5. Send server-to-server POST to Apps Script `/exec` with JSON:
```json
{
  "sharedSecret": "<server-side TFB_API_SECRET>",
  "action": "checkin",
  "token": "<token>",
  "pin": "<pin>"
}
```
6. Let server-side `fetch` follow Apps Script Content Service redirects (do not use browser cross-origin fetch to Apps Script).
7. Parse the resulting JSON response. If Apps Script returns HTML, a login page, an unexpected redirect result or invalid JSON, return a safe 502 error (do not mark the ticket successful).
8. Return only the relevant backend response to the browser.
9. Never log or return the API secret, staff PIN, QR token or full request body.
10. Use a bounded timeout / abort for the upstream request and return a safe timeout error.

Add a health-check route using:
`GET /api/checkin?action=health`

The Vercel serverless function should call the Apps Script `/exec?action=health` server-side and return a response such as:
```json
{
  "ok": true,
  "backendReachable": true,
  "service": "TFB QR Check-In"
}
```

Do not return `backendReachable: true` merely because environment variables exist. It must reflect a successful Apps Script health response.

### Apps Script deployment access

The Vercel server-to-server function does not have a Google login session. The Apps Script Web App must be callable without a Google sign-in, typically by setting Web App access to `Anyone`, while:
- Execute as remains the trusted owner (`trustfbabies@gmail.com`).
- `doPost()` verifies the high-entropy shared secret before invoking check-in logic.
- Staff PIN is still separately checked by `checkInTicket()`.
- If the Google Workspace account does not permit anonymous web apps, report that constraint and propose a secure alternative. Do not silently make the spreadsheet public.

## 7. Frontend behaviour required

In the embedded JavaScript in `index.html`:

### Scanner
- Keep `Html5Qrcode` and existing UI.
- `startScanner()` should check for the QR library and camera availability, but **must not check for `google.script.run`**.
- On Vercel HTTPS, request the environment-facing camera (`facingMode: "environment"`).
- Do not send the token to the backend repeatedly while the same QR remains in view. Pause scanner during validation, then resume after a short delay, or use a decoded-token cooldown.
- `stopScanner()` must stop and clear camera resources.
- Show useful camera errors (permission denied, no device, camera in use, insecure context, library missing) rather than a generic message.

### Ticket verification
- Replace `google.script.run.checkInTicket(...)` with `fetch('/api/checkin', ...)`.
- Use `POST`, `Content-Type: application/json`, and send only `{action, token, pin}`.
- The browser may send the staff PIN over HTTPS to its same-origin Vercel endpoint; the Vercel server then forwards it over HTTPS to Apps Script. Never send the shared API secret from the browser.
- Both camera scans and manual token submissions must use the same backend function.
- Handle non-2xx responses, malformed JSON, timeouts and network errors.
- Never treat a failed backend request as success.
- A successful backend response should update details and recent-scan list.
- A duplicate response should clearly show already checked in.
- `PAYMENT_PENDING`, `NOT_ISSUED`, `INVALID`, `AUTH_FAILED`, `SETUP_REQUIRED` and `SYSTEM_ERROR` must never be styled as entry approved.

### Backend status indicator
- On page load, call `GET /api/checkin?action=health`.
- Show `Backend connected` only after a successful live health result.
- If health fails, show `Backend not connected`, but still allow the camera to start. Verification will then display a backend error until it is available.

## 8. Secrets and security — urgent

The screenshots provided during setup showed:
- The staff PIN in clear text in the scanner page.
- The Vercel API shared secret typed into a spreadsheet modal.

Treat both as compromised. Before production use:
1. Rotate the staff PIN using the Apps Script `setCheckInPin()` function.
2. Rotate the API shared secret using `setVercelApiSecret()`.
3. Update Vercel `TFB_API_SECRET` with the new value.
4. Redeploy Vercel and deploy a new Apps Script version if Code.gs changes.
5. Do not put either secret in this context file, GitHub, `index.html`, logs or screenshots.

The previous shared secret was predictable and appeared in a screenshot. Do not reuse it.

The spreadsheet must not be made publicly readable or editable. Only the Apps Script service account/owner needs spreadsheet access; staff should use the Vercel UI.

## 9. Testing / acceptance criteria

Antigravity must not claim this works until tests are actually run.

### Static and local checks
- Validate JS syntax.
- Verify Vercel function exports using the runtime format supported by this repo.
- Verify the index page retains all original TFB styles, layout, element IDs and responsive design.
- Confirm no `google.script.run` dependency remains in the Vercel scanner path.
- Confirm no `TFB_API_SECRET` appears in client HTML/JS or in Git-tracked environment files.

### Deployed checks
1. Open `https://qr-scanner-kappa-indol.vercel.app/`.
2. Confirm camera can be requested from the Vercel HTTPS origin (the browser should show a camera permission prompt if permission has not already been granted).
3. Confirm `GET /api/checkin?action=health` reports a live Apps Script backend health response.
4. Enter the staff PIN and scan the functional Alizar test ticket.
5. First test scan should succeed and record the test ticket check-in.
6. Second scan should return `ALREADY_USED`.
7. A wrong staff PIN must return `AUTH_FAILED`.
8. An unknown token must return `INVALID`.
9. A real attendee ticket with `TICKET EMAIL STATUS = SENT` but `PAYMENT STATUS != CONFIRMED` must return `PAYMENT_PENDING`.
10. A real attendee ticket with email status SENT and payment status CONFIRMED should be accepted once, and a second scan should be rejected as already used.

Use the isolated `TFB Test Tickets` record for functional testing. Do not test by checking in a real attendee unless explicitly authorised.

### Email / payment workflow
Preserve existing Code.gs email and payment logic. Do not trigger bulk email. Do not modify the event details or recipient mapping. Do not call `sendPendingTickets()` during scanner integration.

## 10. Files / code areas Antigravity should inspect

- `index.html`
  - Embedded styles and front-end JS.
  - Existing `hasAppsScriptBridge()`, `callCheckInBackend()`, `startScanner()`, QR decode and manual-submit handlers.
- `Code.gs`
  - `doGet(e)`
  - `doPost(e)`
  - `jsonResponse_(value)`
  - `checkInTicket(token, pin)`
  - `checkInTestTicket_(ss, qrToken)`
  - `setVercelApiSecret()`
  - `setCheckInPin()`
  - `setupQrCheckIn()`
  - Existing email and payment functions (preserve them).

The current GitHub `Code.gs` has the `doPost()` contract and health route already. Do not write a second conflicting `doPost()` or change the request schema without updating both sides.

---

# Antigravity implementation prompt

You are working in the local repository:
`C:\Users\intel\OneDrive\Documents\QR-Scanner\qr-scanner`

Read this entire `ANTIGRAVITY_CONTEXT.md` first.

Implement the Vercel-hosted QR scanner integration described above. Do not ask me to restate the setup. Inspect the current files before editing.

### Mandatory execution order

1. Inspect the repository, Git status, recent commits, Vercel configuration, `index.html` and `Code.gs`.
2. Create a safe local backup or a new git branch before making edits. Do not discard uncommitted work. Show me the initial `git status`.
3. Confirm the current repository really has `Code.gs` and `index.html`; do not assume separate `script.js` or `style.css` exist.
4. Implement `api/checkin.js` as a Vercel Node serverless function. Match the actual runtime/module style of the project.
5. Update the embedded JavaScript in `index.html`:
   - remove the Apps Script browser bridge dependency;
   - start/stop camera on Vercel HTTPS independently of backend health;
   - send scans/manual tokens to same-origin `/api/checkin`;
   - fetch live backend health;
   - preserve the existing TFB visual design and every required element ID.
6. Inspect the existing `Code.gs` `doPost()` and `checkInTicket()` contract. Reuse it. Only edit `Code.gs` if strictly required for a demonstrated mismatch; preserve all existing ticket/email/payment features.
7. Add or update safe setup documentation for Vercel environment variables. Never place secret values in source, commit messages, browser bundles or logs.
8. Run syntax checks and relevant tests. Inspect the final diff. Do not make a commit or push unless I explicitly request it.

### Implementation details

- Browser → Vercel: `POST /api/checkin` with `{action:"checkin", token, pin}`.
- Vercel → Apps Script: POST the same action/token/pin plus `sharedSecret` read from `process.env.TFB_API_SECRET`.
- `TFB_APPS_SCRIPT_URL` is the Apps Script `/exec` URL.
- `TFB_ALLOWED_ORIGIN` is `https://qr-scanner-kappa-indol.vercel.app`.
- `GET /api/checkin?action=health` must check the actual Apps Script `?action=health` response.
- Server-side fetch must handle Apps Script Content Service redirects and validate that the final response is JSON.
- The browser must never receive the API shared secret.
- Camera startup must not test for `google.script.run`.
- A camera scan is never an approval by itself; only the Apps Script response can approve a ticket.
- Preserve payment gating and duplicate-scan protection.
- Do not run bulk-ticket email functions or mutate real attendee records during development.

### Required final report

When implementation is complete, report:
- files changed and what changed;
- commands/tests actually run and their real results;
- environment variables I must add in Vercel;
- exact Apps Script deployment settings still required;
- whether deployed health check was actually tested;
- any remaining blockers.

Do not claim a successful deployment or live scanner test unless you personally observed it. If the Apps Script endpoint cannot be reached because of access restrictions, explain the exact error and stop rather than weakening spreadsheet permissions.
