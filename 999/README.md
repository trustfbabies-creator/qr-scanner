TFB QR Scanner — Antigravity handoff

1. Open the local qr-scanner repository in Antigravity.
2. Put ANTIGRAVITY_CONTEXT.md in the repository root (or open this file alongside the repo).
3. Copy ANTIGRAVITY_PROMPT.txt into Antigravity chat.
4. Ask Antigravity to inspect and implement, but do not let it commit/push.
5. Review the diff before deployment.

Important security note:
The screenshots in this conversation visibly exposed the previous staff PIN and a predictable API shared secret. Rotate both before production and do not re-use the exposed values. Never paste new secrets into Antigravity chat or source files; use Apps Script Script Properties and Vercel Environment Variables only.
