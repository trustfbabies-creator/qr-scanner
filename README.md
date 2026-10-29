TFB QR CHECK-IN — APPS SCRIPT HOSTED VERSION

This package repackages the existing HTML/JS/CSS so that it runs inside Apps Script HTML Service.
That is required because script.js calls google.script.run. GitHub Pages/Vercel static hosting does not provide google.script.run.

Files:
- Code.gs: existing Apps Script code with explicit spreadsheet ID and a template-based doGet/include helper.
- Index.html: the scanner interface adjusted to include style.html and script.html.
- script.html: JavaScript copied from the provided script.js.
- style.html: CSS copied from the provided style.css.

INSTALL CAREFULLY:
1. In the spreadsheet-bound Apps Script project, BACK UP the current Code.gs first.
2. Replace Code.gs with this package's Code.gs.
3. Add an Apps Script HTML file named exactly Index; paste Index.html content.
4. Add HTML file named exactly script; paste script.html content.
5. Add HTML file named exactly style; paste style.html content.
6. Save all files.
7. Run setupQrCheckIn() once as trustfbabies@gmail.com and authorize.
8. Run setCheckInPin() once and set a private access code >= 16 characters.
9. Ensure the project is connected to the correct spreadsheet and response tab.
10. Deploy > New deployment > Web app; Execute as Me. Restrict access to the intended staff accounts.
11. Open the Apps Script /exec URL on a phone and test with a real issued ticket.
12. First scan should succeed; the second scan should be ALREADY CHECKED IN.

NOTES:
- Do not run sendPendingTickets() until you have verified one real registration ticket and duplicate scan handling.
- Apps Script's web app should be deployed by trustfbabies@gmail.com if emails need to come from that account.
- The test QR from sendTestQrEmailToSahil() is not a real registration ticket and cannot pass check-in verification.
- The GitHub/Vercel UI remains a separate static deployment and will continue to show Backend not connected unless you add a separate API. Use the Apps Script /exec URL for this package.
- Never commit the staff PIN or participant data to GitHub.
- This package was not automatically written to GitHub because GitHub returned HTTP 403 to write operations from the connected integration.
