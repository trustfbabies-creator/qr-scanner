/*
 * TRUST FUND BABIES — ₹1699 COUPLE PASS QR TICKET & CHECK-IN
 *
 * SECOND, INDEPENDENT Apps Script backend for the couple registration form.
 * DO NOT overwrite or merge with the separate ₹999 single-entry Code.gs.
 *
 * One Google Form response row = one couple order = two guests (P1 and P2).
 * Each guest receives their own independent QR ticket (token, ticket ID,
 * email status, check-in status, check-in time). Both guests share a single
 * order-level PAYMENT STATUS. Neither guest is admitted until the organiser
 * marks that row CONFIRMED. Checking in P1 never marks P2 checked-in.
 *
 * Token prefix for every ticket from this backend: TFB1699-
 *
 * Run setup and email functions while signed in as: trustfbabies@gmail.com
 * Store all secrets in Script Properties only — never in source code or logs.
 */

// ─── Required sheet headers — used to locate the response tab ────────────────
// These four headers must ALL exist on the response sheet tab.
// The setup function locates the tab dynamically; the tab name is NOT hardcoded.
var REQUIRED_RESPONSE_HEADERS_1699 = [
  'FULL NAME P1',
  'FULL NAME P2',
  'EMAIL ADDRESS P1',
  'EMAIL ADDRESS P2'
];

// ─── Column header constants ──────────────────────────────────────────────────
// Form-generated column headers are preserved EXACTLY as they appear in the
// actual form response sheet, including the typo "WHASAPP" which matches the
// real form header and must not be corrected here.
var CFG_1699 = {
  NAME_P1_HEADER:   'FULL NAME P1',
  NAME_P2_HEADER:   'FULL NAME P2',
  EMAIL_P1_HEADER:  'EMAIL ADDRESS P1',
  EMAIL_P2_HEADER:  'EMAIL ADDRESS P2',
  PHONE_P1_HEADER:  'WHASAPP NUMBER P1',   // typo in form header — preserved as-is
  PHONE_P2_HEADER:  'WHASAPP NUMBER P2',

  // Transaction reference: detected dynamically from existing form columns.
  // Only appended as a new column if no equivalent heading already exists.
  TRANSACTION_HEADER: 'UTR / TRANSACTION ID',

  // Order-level system columns (shared by both guests)
  ORDER_ID_HEADER:       'COUPLE ORDER ID',
  PAYMENT_STATUS_HEADER: 'PAYMENT STATUS',

  // Per-guest system columns — P1
  TICKET_ID_P1_HEADER:      'QR TICKET ID P1',
  TOKEN_P1_HEADER:          'QR TOKEN P1',
  EMAIL_STATUS_P1_HEADER:   'TICKET EMAIL STATUS P1',
  CHECKIN_STATUS_P1_HEADER: 'CHECK-IN STATUS P1',
  CHECKIN_TIME_P1_HEADER:   'CHECK-IN TIME P1',

  // Per-guest system columns — P2
  TICKET_ID_P2_HEADER:      'QR TICKET ID P2',
  TOKEN_P2_HEADER:          'QR TOKEN P2',
  EMAIL_STATUS_P2_HEADER:   'TICKET EMAIL STATUS P2',
  CHECKIN_STATUS_P2_HEADER: 'CHECK-IN STATUS P2',
  CHECKIN_TIME_P2_HEADER:   'CHECK-IN TIME P2',

  TOKEN_PREFIX: 'TFB1699-'
};

// ─── Event information ────────────────────────────────────────────────────────
var EVENT_1699 = {
  NAME:            'DDLJ Diwali Sundowner',
  DATE:            '01 November 2026',
  VENUE:           'Arunodaya Farms',
  ENTRY_TIME:      '5:00 PM onwards',
  PASS_PRICE:      '\u20b91699 per couple',
  PASS_TYPE:       'Couple Pass (2 guests)',
  FOOD:            'Excluded',
  INSTAGRAM_LABEL: '@trustfbabies',
  INSTAGRAM_URL:   'https://www.instagram.com/trustfbabies/'
};


// =============================================================================
// SECTION 1 — SPREADSHEET MENU
// =============================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('TFB QR Check-In (\u20b91699 Couples)')
    .addItem('1. Set staff access code', 'setCheckInPin1699')
    .addItem('2. Setup couple check-in system', 'setup1699QrCheckIn')
    .addItem('3. Set Vercel API shared secret', 'setVercelApiSecret1699')
    .addSeparator()
    .addItem('Send ticket for selected row', 'sendTicketForSelectedRow1699')
    .addItem('Send all pending couple tickets', 'sendPendingTickets1699')
    .addSeparator()
    .addItem('Mark selected payment CONFIRMED', 'markSelectedPaymentConfirmed1699')
    .addItem('Mark selected payment PENDING', 'markSelectedPaymentPending1699')
    .addToUi();
}


// =============================================================================
// SECTION 2 — SECRET CONFIGURATION
// =============================================================================

/**
 * Prompts for and stores the staff check-in PIN in Script Properties.
 * Use the SAME PIN as the ₹999 backend so that one PIN works on the
 * shared Vercel scanner for both ticket types.
 */
function setCheckInPin1699() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    'Set staff access code (\u20b91699 Couple backend)',
    'Enter the same private access code used in the \u20b9999 backend. ' +
    'Must be at least 16 characters. Give it only to authorised event staff.',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  var pin = response.getResponseText().trim();
  if (pin.length < 16) {
    ui.alert('Code must be at least 16 characters. Nothing was saved. Try again.');
    return;
  }

  PropertiesService.getScriptProperties().setProperty('CHECKIN_PIN', pin);
  ui.alert('Staff access code saved.');
}


/**
 * Prompts for and stores the high-entropy secret that the Vercel serverless
 * function sends to authenticate API calls to this backend.
 * The same value must be added to Vercel as TFB_1699_API_SECRET.
 * This must be DIFFERENT from the ₹999 backend secret.
 */
function setVercelApiSecret1699() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    'Set Vercel API shared secret (\u20b91699 backend)',
    'Paste a randomly generated secret of at least 32 characters. ' +
    'Add the EXACT same value to Vercel as TFB_1699_API_SECRET, then redeploy Vercel. ' +
    'This must be DIFFERENT from the \u20b9999 backend secret.',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  var secret = response.getResponseText().trim();
  if (secret.length < 32) {
    ui.alert('The shared secret must be at least 32 characters. Nothing was saved.');
    return;
  }

  PropertiesService.getScriptProperties().setProperty('TFB_API_SECRET', secret);
  ui.alert(
    'Vercel API shared secret saved in Script Properties.\n\n' +
    'Next: add TFB_1699_API_SECRET in Vercel with the same value, then redeploy Vercel.'
  );
}


// =============================================================================
// SECTION 3 — ONE-TIME SETUP
// =============================================================================

/**
 * One-time setup. Run under trustfbabies@gmail.com from the ₹1699 response
 * spreadsheet's script editor.
 *
 * 1. Locates the response sheet tab by its P1/P2 headers (not by hardcoded name).
 * 2. Appends all required system columns without disturbing form response columns.
 * 3. Persists the spreadsheet ID in Script Properties for web-app use.
 * 4. Creates exactly one form-submit trigger (replaces pre-existing one).
 *
 * Does NOT send emails. Does NOT mark any payment CONFIRMED.
 */
function setup1699QrCheckIn() {
  var ss = getSpreadsheet1699_();
  var sheet = findResponseSheet1699_(ss);

  ensureSystemColumns1699_(sheet);

  // Persist the spreadsheet ID so doPost/doGet can open the sheet reliably.
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());

  // Replace any existing trigger for this handler to avoid duplicates.
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'handle1699FormSubmit') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('handle1699FormSubmit')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();

  notify1699_(
    'Setup complete.\n\n' +
    'Sheet identified: "' + sheet.getName() + '"\n' +
    'System columns added and form-submit trigger created.\n\n' +
    'Next steps:\n' +
    '  1. Run "Set staff access code" if not already done.\n' +
    '  2. Run "Set Vercel API shared secret".\n' +
    '  3. Deploy as Web App:\n' +
    '     Execute as: Me (trustfbabies@gmail.com)\n' +
    '     Who has access: Anyone\n' +
    '  4. Copy the /exec deployment URL to Vercel as TFB_1699_APPS_SCRIPT_URL.\n' +
    '  5. Redeploy Vercel.'
  );
}


// =============================================================================
// SECTION 4 — FORM SUBMIT TRIGGER
// =============================================================================

/**
 * Fires automatically on each new form submission.
 * Sends one QR ticket email to P1 and one to P2 at their respective
 * manually entered EMAIL ADDRESS P1 / P2 values.
 */
function handle1699FormSubmit(e) {
  if (!e || !e.range) {
    throw new Error(
      'handle1699FormSubmit is an installable trigger. ' +
      'Run setup1699QrCheckIn() to create it correctly.'
    );
  }

  var sheet = e.range.getSheet();

  // Guard: only process the confirmed response tab.
  var expectedName = PropertiesService.getScriptProperties().getProperty('RESPONSE_SHEET_NAME');
  if (expectedName && sheet.getName() !== expectedName) return;

  ensureSystemColumns1699_(sheet);
  issueTicketsForRow1699_(sheet, e.range.getRow(), false);
}


// =============================================================================
// SECTION 5 — BULK / MANUAL TICKET FUNCTIONS
// =============================================================================

/**
 * Sends couple QR tickets for all rows where P1 or P2 has not yet been emailed.
 * Rows already fully marked SENT are skipped. Safe to call multiple times.
 * Do NOT call this function automatically during setup.
 */
function sendPendingTickets1699() {
  var ss = getSpreadsheet1699_();
  var sheet = findResponseSheet1699_(ss);
  ensureSystemColumns1699_(sheet);

  var sentBoth = 0, sentPartial = 0, skipped = 0, failed = 0;

  for (var row = 2; row <= sheet.getLastRow(); row++) {
    var result = issueTicketsForRow1699_(sheet, row, false);
    if (result === 'SENT_BOTH')    { sentBoth++;    }
    else if (result === 'SENT_PARTIAL') { sentPartial++; }
    else if (result === 'SKIPPED') { skipped++;     }
    else                           { failed++;      }
  }

  var message =
    '\u20b91699 Couple ticket run completed.\n\n' +
    'Both tickets sent:          ' + sentBoth    + '\n' +
    'Partial (1 of 2 sent):      ' + sentPartial + '\n' +
    'Already done / skipped:     ' + skipped     + '\n' +
    'Failed:                     ' + failed      + '\n\n' +
    'Check TICKET EMAIL STATUS P1 / P2 for details.';

  Logger.log(message);
  notify1699_(message);
}


/**
 * Sends couple tickets for the currently selected row only.
 * Use for testing a single registration or retrying a specific failed row.
 */
function sendTicketForSelectedRow1699() {
  var ss = getSpreadsheet1699_();
  var sheet = findResponseSheet1699_(ss);
  var activeSheet = SpreadsheetApp.getActiveSheet();

  if (!activeSheet || activeSheet.getName() !== sheet.getName()) {
    throw new Error(
      'Open the couple response sheet "' + sheet.getName() +
      '" and select the registration row you want to send.'
    );
  }

  var range = activeSheet.getActiveRange();
  if (!range || range.getRow() < 2) {
    throw new Error('Select a registration row (not the header row).');
  }

  var result = issueTicketsForRow1699_(activeSheet, range.getRow(), false);
  notify1699_('Row ' + range.getRow() + ' result: ' + result);
}


// =============================================================================
// SECTION 6 — PAYMENT STATUS ACTIONS
// =============================================================================

/** Manually marks the selected couple row's payment as CONFIRMED. */
function markSelectedPaymentConfirmed1699() {
  setSelectedPaymentStatus1699_('CONFIRMED');
}

/** Reverts the selected couple row's payment to PENDING. */
function markSelectedPaymentPending1699() {
  setSelectedPaymentStatus1699_('PENDING');
}

function setSelectedPaymentStatus1699_(status) {
  var ss = getSpreadsheet1699_();
  var sheet = findResponseSheet1699_(ss);
  var activeSheet = SpreadsheetApp.getActiveSheet();

  if (!activeSheet || activeSheet.getName() !== sheet.getName()) {
    throw new Error(
      'Open the couple response sheet "' + sheet.getName() + '" and select a registration row.'
    );
  }

  var row = activeSheet.getActiveRange() ? activeSheet.getActiveRange().getRow() : 0;
  if (row < 2) throw new Error('Select a registration row, not the header row.');

  var cols = ensureSystemColumns1699_(activeSheet);
  var paymentCol = cols[headerKey1699_(CFG_1699.PAYMENT_STATUS_HEADER)];
  activeSheet.getRange(row, paymentCol).setValue(status);
  notify1699_('Row ' + row + ': couple payment status set to ' + status + '.');
}


// =============================================================================
// SECTION 7 — TICKET ISSUANCE (CORE)
// =============================================================================

/**
 * Issues QR tickets for one couple registration row.
 *
 * Strategy:
 *  Phase 1 (inside lock):  Read row state. Generate tokens and ticket IDs if
 *                          they do not yet exist. Write all identifiers to the
 *                          sheet. Mark statuses as SENDING. Release lock.
 *  Phase 2 (outside lock): Send P1 email. Send P2 email. Update statuses to
 *                          SENT or ERROR independently.
 *
 * This ensures:
 *  - Tokens are never duplicated across concurrent executions.
 *  - A retry reuses the same token if the email previously failed.
 *  - P2 email failure does not prevent P1 from being SENT, and vice versa.
 *
 * @param {Sheet}   sheet     - The response sheet.
 * @param {number}  row       - 1-based row number (>= 2).
 * @param {boolean} forceSend - Re-send even if already marked SENT.
 * @returns {string} 'SENT_BOTH' | 'SENT_PARTIAL' | 'SKIPPED' | 'ERROR'
 */
function issueTicketsForRow1699_(sheet, row, forceSend) {
  if (row < 2 || row > sheet.getLastRow()) return 'SKIPPED';

  // ── Phase 1: lock, read, generate, write ────────────────────────────────
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  var cols, nameP1, nameP2, emailP1, emailP2;
  var tokenP1, tokenP2, ticketIdP1, ticketIdP2, orderId;
  var statusP1, statusP2, paymentStatus, transactionRef;
  var needsP1, needsP2;

  try {
    cols = ensureSystemColumns1699_(sheet);

    // Read form-response data
    nameP1   = String(sheet.getRange(row, cols[headerKey1699_(CFG_1699.NAME_P1_HEADER)]).getDisplayValue()).trim() || 'Guest 1';
    nameP2   = String(sheet.getRange(row, cols[headerKey1699_(CFG_1699.NAME_P2_HEADER)]).getDisplayValue()).trim() || 'Guest 2';
    emailP1  = String(sheet.getRange(row, cols[headerKey1699_(CFG_1699.EMAIL_P1_HEADER)]).getDisplayValue()).trim();
    emailP2  = String(sheet.getRange(row, cols[headerKey1699_(CFG_1699.EMAIL_P2_HEADER)]).getDisplayValue()).trim();

    // Read transaction reference from whichever column holds it
    var txKey = findTransactionRefColKey1699_(cols);
    transactionRef = txKey
      ? String(sheet.getRange(row, cols[txKey]).getDisplayValue()).trim()
      : '';

    // Initialise payment status to PENDING if blank
    var paymentCol = cols[headerKey1699_(CFG_1699.PAYMENT_STATUS_HEADER)];
    paymentStatus = String(sheet.getRange(row, paymentCol).getDisplayValue()).trim().toUpperCase();
    if (!paymentStatus) {
      sheet.getRange(row, paymentCol).setValue('PENDING');
      paymentStatus = 'PENDING';
    }

    // Read current email statuses
    statusP1 = String(sheet.getRange(row, cols[headerKey1699_(CFG_1699.EMAIL_STATUS_P1_HEADER)]).getDisplayValue()).trim().toUpperCase();
    statusP2 = String(sheet.getRange(row, cols[headerKey1699_(CFG_1699.EMAIL_STATUS_P2_HEADER)]).getDisplayValue()).trim().toUpperCase();

    needsP1 = (statusP1 !== 'SENT' || forceSend);
    needsP2 = (statusP2 !== 'SENT' || forceSend);

    if (!needsP1 && !needsP2) return 'SKIPPED';

    // Validate email addresses before generating tokens
    var emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (needsP1 && !emailRe.test(emailP1)) {
      sheet.getRange(row, cols[headerKey1699_(CFG_1699.EMAIL_STATUS_P1_HEADER)])
        .setValue('ERROR: Invalid or missing EMAIL ADDRESS P1');
      needsP1 = false;
    }
    if (needsP2 && !emailRe.test(emailP2)) {
      sheet.getRange(row, cols[headerKey1699_(CFG_1699.EMAIL_STATUS_P2_HEADER)])
        .setValue('ERROR: Invalid or missing EMAIL ADDRESS P2');
      needsP2 = false;
    }
    if (!needsP1 && !needsP2) return 'ERROR';

    // Generate or reuse P1 token / ticket ID
    tokenP1   = String(sheet.getRange(row, cols[headerKey1699_(CFG_1699.TOKEN_P1_HEADER)]).getDisplayValue()).trim();
    ticketIdP1 = String(sheet.getRange(row, cols[headerKey1699_(CFG_1699.TICKET_ID_P1_HEADER)]).getDisplayValue()).trim();
    if (!tokenP1) {
      tokenP1 = CFG_1699.TOKEN_PREFIX + Utilities.getUuid().replace(/-/g, '').toUpperCase();
    }
    if (!ticketIdP1) {
      ticketIdP1 = 'TFB1699-P1-' + tokenP1.slice(CFG_1699.TOKEN_PREFIX.length, CFG_1699.TOKEN_PREFIX.length + 8);
    }

    // Generate or reuse P2 token / ticket ID
    tokenP2   = String(sheet.getRange(row, cols[headerKey1699_(CFG_1699.TOKEN_P2_HEADER)]).getDisplayValue()).trim();
    ticketIdP2 = String(sheet.getRange(row, cols[headerKey1699_(CFG_1699.TICKET_ID_P2_HEADER)]).getDisplayValue()).trim();
    if (!tokenP2) {
      tokenP2 = CFG_1699.TOKEN_PREFIX + Utilities.getUuid().replace(/-/g, '').toUpperCase();
    }
    if (!ticketIdP2) {
      ticketIdP2 = 'TFB1699-P2-' + tokenP2.slice(CFG_1699.TOKEN_PREFIX.length, CFG_1699.TOKEN_PREFIX.length + 8);
    }

    // Guarantee P1 and P2 tokens are always distinct
    while (tokenP2 === tokenP1) {
      tokenP2   = CFG_1699.TOKEN_PREFIX + Utilities.getUuid().replace(/-/g, '').toUpperCase();
      ticketIdP2 = 'TFB1699-P2-' + tokenP2.slice(CFG_1699.TOKEN_PREFIX.length, CFG_1699.TOKEN_PREFIX.length + 8);
    }

    // Generate or reuse couple order ID
    orderId = String(sheet.getRange(row, cols[headerKey1699_(CFG_1699.ORDER_ID_HEADER)]).getDisplayValue()).trim();
    if (!orderId) {
      orderId = 'CPL-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
    }

    // Write identifiers BEFORE sending emails so a retry reuses the same tokens
    sheet.getRange(row, cols[headerKey1699_(CFG_1699.ORDER_ID_HEADER)]).setValue(orderId);
    sheet.getRange(row, cols[headerKey1699_(CFG_1699.TOKEN_P1_HEADER)]).setValue(tokenP1);
    sheet.getRange(row, cols[headerKey1699_(CFG_1699.TICKET_ID_P1_HEADER)]).setValue(ticketIdP1);
    sheet.getRange(row, cols[headerKey1699_(CFG_1699.TOKEN_P2_HEADER)]).setValue(tokenP2);
    sheet.getRange(row, cols[headerKey1699_(CFG_1699.TICKET_ID_P2_HEADER)]).setValue(ticketIdP2);

    if (needsP1) sheet.getRange(row, cols[headerKey1699_(CFG_1699.EMAIL_STATUS_P1_HEADER)]).setValue('SENDING');
    if (needsP2) sheet.getRange(row, cols[headerKey1699_(CFG_1699.EMAIL_STATUS_P2_HEADER)]).setValue('SENDING');

    SpreadsheetApp.flush();

  } finally {
    lock.releaseLock();
  }

  // ── Phase 2: send emails OUTSIDE the lock ──────────────────────────────
  var sentP1 = needsP1 ? null : (statusP1 === 'SENT' ? 'ALREADY_SENT' : 'SKIPPED');
  var sentP2 = needsP2 ? null : (statusP2 === 'SENT' ? 'ALREADY_SENT' : 'SKIPPED');

  if (needsP1) {
    try {
      var qrP1 = createQrImage1699_(tokenP1, ticketIdP1);
      var contentP1 = buildCoupleTicketEmail1699_({
        guestName: nameP1, companionName: nameP2,
        ticketId: ticketIdP1, transactionRef: transactionRef,
        paymentStatus: paymentStatus, orderId: orderId
      });
      GmailApp.sendEmail(
        emailP1,
        'Your ' + EVENT_1699.NAME + ' Couple Pass — ' + nameP1,
        contentP1.plainBody,
        { name: 'Trust Fund Babies', htmlBody: contentP1.htmlBody, inlineImages: { ticketQr: qrP1 } }
      );
      sheet.getRange(row, cols[headerKey1699_(CFG_1699.EMAIL_STATUS_P1_HEADER)]).setValue('SENT');
      sentP1 = 'SENT';
    } catch (e1) {
      var d1 = String(e1.message || e1).substring(0, 160);
      sheet.getRange(row, cols[headerKey1699_(CFG_1699.EMAIL_STATUS_P1_HEADER)]).setValue('ERROR: ' + d1);
      Logger.log('Row ' + row + ' P1 email error: ' + d1);
      sentP1 = 'ERROR';
    }
  }

  if (needsP2) {
    try {
      var qrP2 = createQrImage1699_(tokenP2, ticketIdP2);
      var contentP2 = buildCoupleTicketEmail1699_({
        guestName: nameP2, companionName: nameP1,
        ticketId: ticketIdP2, transactionRef: transactionRef,
        paymentStatus: paymentStatus, orderId: orderId
      });
      GmailApp.sendEmail(
        emailP2,
        'Your ' + EVENT_1699.NAME + ' Couple Pass — ' + nameP2,
        contentP2.plainBody,
        { name: 'Trust Fund Babies', htmlBody: contentP2.htmlBody, inlineImages: { ticketQr: qrP2 } }
      );
      sheet.getRange(row, cols[headerKey1699_(CFG_1699.EMAIL_STATUS_P2_HEADER)]).setValue('SENT');
      sentP2 = 'SENT';
    } catch (e2) {
      var d2 = String(e2.message || e2).substring(0, 160);
      sheet.getRange(row, cols[headerKey1699_(CFG_1699.EMAIL_STATUS_P2_HEADER)]).setValue('ERROR: ' + d2);
      Logger.log('Row ' + row + ' P2 email error: ' + d2);
      sentP2 = 'ERROR';
    }
  }

  SpreadsheetApp.flush();

  // Summarise
  var bothDone   = (sentP1 === 'SENT' || sentP1 === 'ALREADY_SENT') &&
                   (sentP2 === 'SENT' || sentP2 === 'ALREADY_SENT');
  var anyNewSent = (sentP1 === 'SENT' || sentP2 === 'SENT');
  var anyError   = (sentP1 === 'ERROR' || sentP2 === 'ERROR');

  if (bothDone && !anyError)  return 'SENT_BOTH';
  if (anyNewSent)             return 'SENT_PARTIAL';
  if (anyError)               return 'ERROR';
  return 'SKIPPED';
}


// =============================================================================
// SECTION 8 — QR IMAGE GENERATION
// =============================================================================

/**
 * Creates a PNG QR image blob encoding ONLY the random token.
 * No personal information is ever encoded in the QR.
 */
function createQrImage1699_(token, ticketId) {
  var url =
    'https://quickchart.io/qr?size=360&margin=3&format=png&text=' +
    encodeURIComponent(token);

  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

  if (response.getResponseCode() !== 200) {
    throw new Error('QR image service returned HTTP ' + response.getResponseCode());
  }

  return response.getBlob()
    .setName(ticketId + '.png')
    .setContentType('image/png');
}


// =============================================================================
// SECTION 9 — EMAIL BUILDER
// =============================================================================

/**
 * Builds a professional TFB-branded couple ticket email for one guest.
 *
 * @param {Object} data
 *   .guestName      — this guest's name
 *   .companionName  — the other guest's name
 *   .ticketId       — this guest's unique ticket ID
 *   .transactionRef — shared payment transaction reference
 *   .paymentStatus  — 'CONFIRMED' | 'PENDING' | other
 *   .orderId        — couple order ID
 * @returns {{ plainBody: string, htmlBody: string }}
 */
function buildCoupleTicketEmail1699_(data) {
  var guestName  = escapeHtml1699_(data.guestName      || 'Guest');
  var companion  = escapeHtml1699_(data.companionName   || 'Your companion');
  var ticketId   = escapeHtml1699_(data.ticketId        || '');
  var transRef   = escapeHtml1699_(data.transactionRef  || 'Not provided');
  var orderId    = escapeHtml1699_(data.orderId         || '');
  var payStatus  = String(data.paymentStatus || 'PENDING').toUpperCase();
  var confirmed  = (payStatus === 'CONFIRMED');

  var payTitle   = confirmed ? 'PAYMENT VERIFIED' : 'PAYMENT VERIFICATION PENDING';
  var payMsg     = confirmed
    ? 'Your payment has been verified. Keep this email and present your unique QR code at the venue entry.'
    : 'We have received your couple registration. Our team will verify your transaction reference and payment screenshot. Entry is approved only after successful payment verification.';
  var qrNote     = confirmed
    ? 'Your payment is verified. Keep this QR private and show it to the authorised entry team at the venue.'
    : 'Keep this QR private and show it to the authorised entry team. This QR will not be accepted at entry until your payment is marked CONFIRMED by the organiser.';

  var pink     = '#f02e9d';
  var payBg    = confirmed ? '#effaf3' : '#fff3f8';
  var payColor = confirmed ? '#137a3c' : '#b31665';
  var igUrl    = EVENT_1699.INSTAGRAM_URL;

  // ── Plain text ──────────────────────────────────────────────────────────
  var plainBody =
    'TRUST FUND BABIES — COUPLE REGISTRATION\n\n' +
    'Registration received, ' + (data.guestName || 'Guest') + '.\n' +
    'Thank you for registering for ' + EVENT_1699.NAME + '.\n\n' +
    'YOUR EVENT DETAILS\n' +
    'Your name:            ' + (data.guestName     || 'Guest') + '\n' +
    'Companion:            ' + (data.companionName  || 'Your companion') + '\n' +
    'Event:                ' + EVENT_1699.NAME + '\n' +
    'Date:                 ' + EVENT_1699.DATE + '\n' +
    'Venue:                ' + EVENT_1699.VENUE + '\n' +
    'Entry:                ' + EVENT_1699.ENTRY_TIME + '\n' +
    'Pass price:           ' + EVENT_1699.PASS_PRICE + '\n' +
    'Food:                 ' + EVENT_1699.FOOD + '\n' +
    (orderId    ? 'Couple order ID:      ' + (data.orderId        || '') + '\n' : '') +
    'Transaction ref.:     ' + (data.transactionRef || 'Not provided') + '\n\n' +
    payTitle + '\n' + payMsg + '\n\n' +
    'YOUR QR TICKET\n' +
    'Ticket ID: ' + (data.ticketId || '') + '\n' +
    qrNote + '\n\n' +
    'NOTE: ' + (data.companionName || 'Your companion') +
    ' will receive their own separate QR pass at their registered email address. ' +
    'Each pass is unique and must be scanned independently at entry.\n\n' +
    'Follow ' + EVENT_1699.INSTAGRAM_LABEL + ': ' + EVENT_1699.INSTAGRAM_URL + '\n\n' +
    'TFB — TRUST FUND BABIES\n' +
    'No refunds after payment confirmation. Please retain your transaction reference.';

  // ── HTML ────────────────────────────────────────────────────────────────
  var htmlBody =
    '<!doctype html>' +
    '<html lang="en">' +
    '<head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml1699_(EVENT_1699.NAME) + ' \u2014 Couple Registration</title>' +
    '</head>' +
    '<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#19131a;">' +

    // Preview text (hidden)
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' +
    'Your couple pass for ' + escapeHtml1699_(EVENT_1699.NAME) + ' \u2014 ' + guestName + '.' +
    '</div>' +

    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f4f6;padding:20px 8px;">' +
    '<tr><td align="center">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border-collapse:separate;border-spacing:0;">' +

    // ── Header ──
    '<tr><td style="padding:20px 24px;background:#171018;border-bottom:4px solid ' + pink + ';">' +
    '<div style="font-size:16px;font-weight:800;letter-spacing:2px;color:' + pink + ';">TRUST FUND BABIES</div>' +
    '<div style="font-size:11px;letter-spacing:1.5px;color:#f8edf4;margin-top:5px;">EVENT REGISTRATION</div>' +
    '</td></tr>' +

    // ── Intro ──
    '<tr><td style="padding:24px;background:#fff7fb;">' +
    '<div style="font-size:11px;font-weight:800;letter-spacing:2px;color:' + pink + ';">COUPLE REGISTRATION RECEIVED</div>' +
    '<h1 style="margin:10px 0 10px;font-size:24px;line-height:1.25;color:#211521;">You\'re registered, ' + guestName + '.</h1>' +
    '<p style="margin:0;font-size:15px;line-height:1.65;color:#403640;">' +
    'Thank you for registering for <strong style="color:' + pink + ';">' + escapeHtml1699_(EVENT_1699.NAME) + '</strong>. This is your personal couple pass.' +
    '</p>' +
    '</td></tr>' +

    // ── Event details ──
    '<tr><td style="padding:22px 24px 14px;">' +
    '<h2 style="margin:0 0 14px;font-size:15px;letter-spacing:.3px;color:#211521;">YOUR EVENT DETAILS</h2>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-size:14px;">' +
    emailDetailRow1699_('Your name',       guestName) +
    emailDetailRow1699_('Companion',       companion) +
    emailDetailRow1699_('Event',           escapeHtml1699_(EVENT_1699.NAME)) +
    emailDetailRow1699_('Date',            escapeHtml1699_(EVENT_1699.DATE)) +
    emailDetailRow1699_('Venue',           escapeHtml1699_(EVENT_1699.VENUE)) +
    emailDetailRow1699_('Entry',           escapeHtml1699_(EVENT_1699.ENTRY_TIME)) +
    emailDetailRow1699_('Pass price',      '<strong style="color:' + pink + ';">' + escapeHtml1699_(EVENT_1699.PASS_PRICE) + '</strong>') +
    emailDetailRow1699_('Food',            escapeHtml1699_(EVENT_1699.FOOD)) +
    (orderId ? emailDetailRow1699_('Couple order ID', orderId) : '') +
    emailDetailRow1699_('Transaction ref.', transRef) +
    '</table>' +
    '</td></tr>' +

    // ── Payment status ──
    '<tr><td style="padding:8px 24px 20px;">' +
    '<div style="padding:14px 16px;border-left:4px solid ' + pink + ';background:' + payBg + ';">' +
    '<div style="font-size:12px;font-weight:800;letter-spacing:.7px;color:' + payColor + ';">' + payTitle + '</div>' +
    '<p style="margin:7px 0 0;font-size:13px;line-height:1.6;color:#403640;">' + payMsg + '</p>' +
    '</div>' +
    '</td></tr>' +

    // ── QR ticket ──
    '<tr><td style="padding:0 24px 24px;">' +
    '<div style="border:1px solid #eadfe7;border-radius:10px;padding:18px;text-align:center;">' +
    '<div style="font-size:11px;font-weight:800;letter-spacing:1.5px;color:' + pink + ';">YOUR QR TICKET</div>' +
    '<div style="margin-top:8px;font-size:13px;color:#635663;">Ticket ID: <strong style="color:#211521;">' + ticketId + '</strong></div>' +
    '<img src="cid:ticketQr" width="220" height="220" alt="Your unique couple QR ticket" ' +
    'style="display:block;width:220px;height:220px;max-width:100%;margin:14px auto 8px;border:0;">' +
    '<p style="margin:0;font-size:12px;line-height:1.6;color:#635663;">' + qrNote + '</p>' +
    '</div>' +
    '</td></tr>' +

    // ── Companion note ──
    '<tr><td style="padding:0 24px 16px;">' +
    '<div style="padding:12px 16px;background:#f9f3f7;border-radius:6px;font-size:13px;color:#403640;line-height:1.6;">' +
    '<strong>' + companion + '</strong> will receive their own separate QR pass at their registered email address. ' +
    'Each pass must be scanned independently at the entry desk.' +
    '</div>' +
    '</td></tr>' +

    // ── CTA ──
    '<tr><td style="padding:0 24px 24px;">' +
    '<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#403640;">See you at the sundowner.</p>' +
    '<a href="' + igUrl + '" style="display:inline-block;padding:10px 15px;background:' + pink + ';border-radius:4px;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;">Follow ' + EVENT_1699.INSTAGRAM_LABEL + '</a>' +
    '</td></tr>' +

    // ── Footer ──
    '<tr><td style="padding:17px 24px;background:#171018;border-top:3px solid ' + pink + ';">' +
    '<div style="font-size:12px;font-weight:800;letter-spacing:.6px;color:' + pink + ';">TFB \u2014 TRUST FUND BABIES</div>' +
    '<p style="margin:8px 0 0;font-size:11px;line-height:1.6;color:#f4eaf2;">No refunds after payment confirmation. Please retain your transaction reference.</p>' +
    '</td></tr>' +

    '</table>' +
    '<p style="max-width:560px;margin:12px auto 0;font-size:10px;line-height:1.5;color:#777;text-align:center;">' +
    'This is an automated registration acknowledgement. Payment status is shown above.' +
    '</p>' +
    '</td></tr></table>' +
    '</body></html>';

  return { plainBody: plainBody, htmlBody: htmlBody };
}

function emailDetailRow1699_(label, valueHtml) {
  return '<tr>' +
    '<td style="width:38%;padding:9px 0;border-bottom:1px solid #eee3eb;color:#776b76;vertical-align:top;">' +
    escapeHtml1699_(label) + '</td>' +
    '<td style="padding:9px 0;border-bottom:1px solid #eee3eb;color:#211521;vertical-align:top;">' +
    valueHtml + '</td>' +
    '</tr>';
}


// =============================================================================
// SECTION 10 — WEB APP ENDPOINTS
// =============================================================================

/**
 * Health check endpoint.
 * GET ?action=health  →  JSON with backend identity "1699".
 * This backend does NOT serve an HTML scanner UI; camera is on Vercel.
 */
function doGet(e) {
  var action = e && e.parameter && String(e.parameter.action || '').toLowerCase();
  if (action === 'health') {
    return jsonResponse1699_({
      ok: true,
      service: 'TFB Couple Pass \u20b91699',
      backend: '1699',
      timestamp: new Date().toISOString()
    });
  }
  return jsonResponse1699_({
    ok: false,
    code: 'NOT_FOUND',
    message: 'This endpoint only responds to ?action=health. The QR scanner UI is hosted on Vercel.'
  });
}


/**
 * Authenticated API endpoint called by the Vercel serverless proxy.
 *
 * The browser NEVER calls this directly. It sends { action, token, pin } to
 * POST /api/checkin on Vercel, and Vercel injects the sharedSecret server-side
 * from TFB_1699_API_SECRET before forwarding to this endpoint.
 *
 * Expected JSON body:
 *   { sharedSecret: "...", action: "checkin", token: "TFB1699-...", pin: "..." }
 */
function doPost(e) {
  try {
    var raw  = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var data = JSON.parse(raw);

    var expectedSecret = PropertiesService.getScriptProperties().getProperty('TFB_API_SECRET');
    var providedSecret = String(data.sharedSecret || data.apiSecret || '');

    if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
      return jsonResponse1699_({ ok: false, code: 'AUTH_FAILED', message: 'Backend authentication failed.' });
    }

    if (String(data.action || '').toLowerCase() !== 'checkin') {
      return jsonResponse1699_({ ok: false, code: 'INVALID_ACTION', message: 'Unsupported API action.' });
    }

    var result = checkInTicket(data.token, data.pin);
    return jsonResponse1699_(result);

  } catch (error) {
    Logger.log('API error: ' + (error && error.stack ? error.stack : error));
    return jsonResponse1699_({ ok: false, code: 'SYSTEM_ERROR', message: 'The check-in request could not be processed.' });
  }
}


// =============================================================================
// SECTION 11 — CHECK-IN LOGIC
// =============================================================================

/**
 * Validates a scanned QR token and checks in the matching guest (P1 or P2).
 *
 * All of these conditions must be true before admitting a guest:
 *  1. Staff PIN must match CHECKIN_PIN in Script Properties.
 *  2. Token must start with 'TFB1699-' (this backend only).
 *  3. Token must match exactly one QR TOKEN P1 or QR TOKEN P2 cell.
 *  4. That guest's TICKET EMAIL STATUS Px must equal 'SENT'.
 *  5. The couple row's PAYMENT STATUS must equal 'CONFIRMED'.
 *  6. That guest's CHECK-IN STATUS Px must NOT already be 'CHECKED IN'.
 *  7. On success, write 'CHECKED IN' and timestamp to that guest's columns ONLY.
 *     The other guest's check-in state is NEVER modified.
 *
 * Response JSON is compatible with the Vercel scanner UI contract.
 *
 * @param  {string} token - Raw QR code content.
 * @param  {string} pin   - Staff access code from the scanner.
 * @returns {Object}
 */
function checkInTicket(token, pin) {
  // ── PIN ──────────────────────────────────────────────────────────────────
  var expectedPin = PropertiesService.getScriptProperties().getProperty('CHECKIN_PIN');
  if (!expectedPin) {
    return { ok: false, code: 'SETUP_REQUIRED', message: 'Staff access code has not been configured. Run setup first.' };
  }
  if (String(pin || '') !== expectedPin) {
    return { ok: false, code: 'AUTH_FAILED', message: 'Incorrect staff access code.' };
  }

  // ── Token prefix guard ───────────────────────────────────────────────────
  var qrToken = String(token || '').trim();
  if (!qrToken) {
    return { ok: false, code: 'INVALID', message: 'Empty QR code.' };
  }
  if (qrToken.indexOf(CFG_1699.TOKEN_PREFIX) !== 0) {
    return {
      ok: false, code: 'INVALID',
      message: 'This token was not issued by the \u20b91699 couple backend.',
      testTicket: false
    };
  }

  // ── Database lookup (inside lock to prevent double check-in races) ───────
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    var ss    = getSpreadsheet1699_();
    var sheet = findResponseSheet1699_(ss);
    var cols  = ensureSystemColumns1699_(sheet);

    var lastRow  = sheet.getLastRow();
    if (lastRow < 2) {
      return { ok: false, code: 'INVALID', message: 'No registrations found in the couple response sheet.' };
    }

    var dataRows    = lastRow - 1;
    var tokenP1Col  = cols[headerKey1699_(CFG_1699.TOKEN_P1_HEADER)];
    var tokenP2Col  = cols[headerKey1699_(CFG_1699.TOKEN_P2_HEADER)];

    var tokenP1Values = sheet.getRange(2, tokenP1Col, dataRows, 1).getDisplayValues();
    var tokenP2Values = sheet.getRange(2, tokenP2Col, dataRows, 1).getDisplayValues();

    var matchRow    = 0;
    var matchGuest  = null; // 'P1' or 'P2'

    for (var i = 0; i < dataRows; i++) {
      if (String(tokenP1Values[i][0]).trim() === qrToken) {
        matchRow   = i + 2;
        matchGuest = 'P1';
        break;
      }
      if (String(tokenP2Values[i][0]).trim() === qrToken) {
        matchRow   = i + 2;
        matchGuest = 'P2';
        break;
      }
    }

    if (!matchRow) {
      return { ok: false, code: 'INVALID', message: 'INVALID QR TICKET', detail: 'No matching couple registration found.', testTicket: false };
    }

    // ── Resolve per-guest column headers ──────────────────────────────────
    var nameHdr      = (matchGuest === 'P1') ? CFG_1699.NAME_P1_HEADER           : CFG_1699.NAME_P2_HEADER;
    var emailStatHdr = (matchGuest === 'P1') ? CFG_1699.EMAIL_STATUS_P1_HEADER   : CFG_1699.EMAIL_STATUS_P2_HEADER;
    var ciStatHdr    = (matchGuest === 'P1') ? CFG_1699.CHECKIN_STATUS_P1_HEADER : CFG_1699.CHECKIN_STATUS_P2_HEADER;
    var ciTimeHdr    = (matchGuest === 'P1') ? CFG_1699.CHECKIN_TIME_P1_HEADER   : CFG_1699.CHECKIN_TIME_P2_HEADER;
    var ticketIdHdr  = (matchGuest === 'P1') ? CFG_1699.TICKET_ID_P1_HEADER      : CFG_1699.TICKET_ID_P2_HEADER;

    // ── Email status ──────────────────────────────────────────────────────
    var emailStatus = String(
      sheet.getRange(matchRow, cols[headerKey1699_(emailStatHdr)]).getDisplayValue()
    ).trim().toUpperCase();

    if (emailStatus !== 'SENT') {
      return { ok: false, code: 'NOT_ISSUED', message: 'This ticket has not been successfully issued.', testTicket: false };
    }

    // ── Couple payment status ─────────────────────────────────────────────
    var paymentStatus = String(
      sheet.getRange(matchRow, cols[headerKey1699_(CFG_1699.PAYMENT_STATUS_HEADER)]).getDisplayValue()
    ).trim().toUpperCase();

    if (paymentStatus !== 'CONFIRMED') {
      return {
        ok: false, code: 'PAYMENT_PENDING',
        message: 'PAYMENT VERIFICATION PENDING',
        detail: 'Couple registration found, but entry is blocked until the organiser marks payment CONFIRMED.',
        testTicket: false
      };
    }

    // ── Guest details ─────────────────────────────────────────────────────
    var guestName = String(
      sheet.getRange(matchRow, cols[headerKey1699_(nameHdr)]).getDisplayValue()
    ).trim() || (matchGuest === 'P1' ? 'Guest 1' : 'Guest 2');

    var ticketId = String(
      sheet.getRange(matchRow, cols[headerKey1699_(ticketIdHdr)]).getDisplayValue()
    ).trim();

    var ciCol       = cols[headerKey1699_(ciStatHdr)];
    var ciTimeCol   = cols[headerKey1699_(ciTimeHdr)];
    var prevStatus  = String(sheet.getRange(matchRow, ciCol).getDisplayValue()).trim().toUpperCase();
    var prevTime    = sheet.getRange(matchRow, ciTimeCol).getValue();

    // ── Duplicate scan guard ──────────────────────────────────────────────
    if (prevStatus === 'CHECKED IN') {
      return {
        ok: false, code: 'ALREADY_USED', message: 'ALREADY CHECKED IN',
        name: guestName, ticketId: ticketId,
        checkedAt: formatCheckinTime1699_(prevTime), testTicket: false
      };
    }

    // ── Admit: write check-in for this guest ONLY ─────────────────────────
    var now = new Date();
    sheet.getRange(matchRow, ciCol).setValue('CHECKED IN');
    sheet.getRange(matchRow, ciTimeCol).setValue(now);
    SpreadsheetApp.flush();

    return {
      ok: true, code: 'SUCCESS', message: 'CHECK-IN SUCCESSFUL',
      name: guestName, ticketId: ticketId,
      checkedAt: formatCheckinTime1699_(now), testTicket: false
    };

  } catch (error) {
    Logger.log('Check-in error: ' + (error && error.stack ? error.stack : error));
    return { ok: false, code: 'SYSTEM_ERROR', message: 'System error. Contact the event lead.' };
  } finally {
    lock.releaseLock();
  }
}


// =============================================================================
// SECTION 12 — SPREADSHEET HELPERS
// =============================================================================

/**
 * Opens the ₹1699 couple response spreadsheet.
 * In doPost / doGet (web-app context) getActiveSpreadsheet() is unavailable,
 * so we rely on the SPREADSHEET_ID stored during setup.
 */
function getSpreadsheet1699_() {
  var props   = PropertiesService.getScriptProperties();
  var savedId = String(props.getProperty('SPREADSHEET_ID') || '').trim();
  var ss;

  if (savedId) {
    try { ss = SpreadsheetApp.openById(savedId); } catch (_) { ss = null; }
  }
  if (!ss) {
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (_) { ss = null; }
  }
  if (!ss) {
    throw new Error(
      'Cannot open the couple registration spreadsheet.\n\n' +
      'Open the "\u20b91699 response" spreadsheet and use Extensions \u2192 Apps Script ' +
      'to open this script, then run setup1699QrCheckIn().'
    );
  }

  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}


/**
 * Locates the response sheet tab by verifying it contains ALL four required
 * P1/P2 headers. Raises a clear error if zero or multiple tabs match.
 * Also saves the confirmed tab name so the form-submit trigger can guard quickly.
 */
function findResponseSheet1699_(ss) {
  var sheets  = ss.getSheets();
  var matches = [];

  sheets.forEach(function(sheet) {
    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) return;
    var headerRow = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
    var keys      = headerRow.map(function(h) { return headerKey1699_(h); });

    var allFound = REQUIRED_RESPONSE_HEADERS_1699.every(function(req) {
      return keys.indexOf(headerKey1699_(req)) !== -1;
    });

    if (allFound) matches.push(sheet);
  });

  if (matches.length === 0) {
    var tabList = sheets.map(function(s) { return '"' + s.getName() + '"'; }).join(', ');
    throw new Error(
      'No sheet tab was found containing all required couple headers ' +
      '(FULL NAME P1, FULL NAME P2, EMAIL ADDRESS P1, EMAIL ADDRESS P2).\n\n' +
      'Tabs in this spreadsheet: ' + tabList + '\n\n' +
      'Ensure this script is bound to the correct couple response spreadsheet.'
    );
  }

  if (matches.length > 1) {
    var nameList = matches.map(function(s) { return '"' + s.getName() + '"'; }).join(', ');
    throw new Error(
      'Multiple sheet tabs matched the couple headers: ' + nameList + '\n\n' +
      'Remove duplicate header rows and run setup again.'
    );
  }

  PropertiesService.getScriptProperties()
    .setProperty('RESPONSE_SHEET_NAME', matches[0].getName());

  return matches[0];
}


/**
 * Ensures all required system columns exist on the response sheet.
 * Never renames, reorders or removes existing columns.
 * Detects existing transaction-reference columns to avoid creating duplicates.
 * Initialises blank PAYMENT STATUS cells to PENDING.
 *
 * @returns {Object} Map from normalised header key → 1-based column index.
 */
function ensureSystemColumns1699_(sheet) {
  var systemHeaders = [
    CFG_1699.ORDER_ID_HEADER,
    CFG_1699.PAYMENT_STATUS_HEADER,
    CFG_1699.TICKET_ID_P1_HEADER,
    CFG_1699.TOKEN_P1_HEADER,
    CFG_1699.EMAIL_STATUS_P1_HEADER,
    CFG_1699.CHECKIN_STATUS_P1_HEADER,
    CFG_1699.CHECKIN_TIME_P1_HEADER,
    CFG_1699.TICKET_ID_P2_HEADER,
    CFG_1699.TOKEN_P2_HEADER,
    CFG_1699.EMAIL_STATUS_P2_HEADER,
    CFG_1699.CHECKIN_STATUS_P2_HEADER,
    CFG_1699.CHECKIN_TIME_P2_HEADER
  ];

  var lastCol   = Math.max(sheet.getLastColumn(), 1);
  var curHdrs   = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var curKeySet = new Set(curHdrs.map(function(h) { return headerKey1699_(h); }));

  // Only append UTR column if no equivalent transaction-reference column exists.
  if (!doesTransactionColExist1699_(curKeySet)) {
    systemHeaders.unshift(CFG_1699.TRANSACTION_HEADER);
  }

  systemHeaders.forEach(function(hdr) {
    var key = headerKey1699_(hdr);
    if (!curKeySet.has(key)) {
      var newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue(hdr).setFontWeight('bold');
      curKeySet.add(key);

      // Default PAYMENT STATUS to PENDING for all existing data rows.
      if (key === headerKey1699_(CFG_1699.PAYMENT_STATUS_HEADER)) {
        var lastData = sheet.getLastRow();
        if (lastData >= 2) {
          sheet.getRange(2, newCol, lastData - 1, 1)
            .setValues(Array.from({ length: lastData - 1 }, function() { return ['PENDING']; }));
        }
      }
    }
  });

  return getColumnMap1699_(sheet);
}


/** Returns true if the existing header key set already contains a transaction-reference column. */
function doesTransactionColExist1699_(keySet) {
  var markers = ['TRANSACTION', 'UTR', 'PAYMENT REF'];
  var found = false;
  keySet.forEach(function(k) {
    markers.forEach(function(m) { if (k.indexOf(m) !== -1) found = true; });
  });
  return found;
}


/** Returns the column-map key for the transaction reference column, or null. */
function findTransactionRefColKey1699_(colMap) {
  var markers = ['TRANSACTION', 'UTR', 'PAYMENT REF'];
  var keys    = Object.keys(colMap);
  for (var i = 0; i < keys.length; i++) {
    for (var j = 0; j < markers.length; j++) {
      if (keys[i].indexOf(markers[j]) !== -1) return keys[i];
    }
  }
  return null;
}


/** Builds a column-index map (normalised header key → 1-based column number). */
function getColumnMap1699_(sheet) {
  var lastCol = sheet.getLastColumn();
  var hdrs    = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var map     = {};
  hdrs.forEach(function(h, idx) {
    var k = headerKey1699_(h);
    if (k) map[k] = idx + 1; // rightmost occurrence wins for duplicates
  });
  return map;
}


/** Normalises a header string: trim, collapse spaces, uppercase. */
function headerKey1699_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}


// =============================================================================
// SECTION 13 — UTILITY HELPERS
// =============================================================================

function escapeHtml1699_(value) {
  var r = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value || '').replace(/[&<>"']/g, function(c) { return r[c]; });
}

function formatCheckinTime1699_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd MMM yyyy, hh:mm:ss a');
  }
  return value ? String(value) : '';
}

function notify1699_(message) {
  try { SpreadsheetApp.getUi().alert(message); } catch (_) { Logger.log(message); }
}

function jsonResponse1699_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

