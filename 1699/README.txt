TFB ₹1699 Couple Form — Antigravity Handoff

Files:
- TFB_1699_COUPLE_CONTEXT.md: verified facts, headers, architecture, ticket model, security, setup and acceptance criteria.
- ANTIGRAVITY_PROMPT_1699.txt: paste the prompt into Antigravity Agent after opening the qr-scanner workspace.

Important:
- There are two distinct Apps Script backends and spreadsheets.
- Do not overwrite the existing ₹999 Code.gs or its Apps Script deployment.
- One couple response must produce two separately checkable tickets.
- The second spreadsheet ID is not visible in the screenshots. The new Apps Script must be container-bound to the second form response spreadsheet and capture its ID during setup; if not bound, Antigravity must ask for the second sheet URL rather than guess.
- The same Vercel scanner must route TFB1699- tokens to the new backend.
- Existing form sheet shows three responses. Do not send any emails or update real response records during implementation.
- Rotate any previously exposed staff PIN/API secrets before production. No secrets belong in this package or in Git.
