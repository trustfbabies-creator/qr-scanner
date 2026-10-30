
/*
 * TRUST FUND BABIES — QR TICKET & CHECK-IN
 *
 * Run the setup and email functions while signed in as:
 * trustfbabies@gmail.com
 */

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

const EVENT = {
  NAME: 'DDLJ Diwali Sundowner',
  DATE: '01 November 2026',
  VENUE: 'Arunodaya Farms',
  ENTRY_TIME: '5:00 PM onwards',
  PASS_PRICE: '₹999 per person',
  INSTAGRAM_LABEL: '@trustfbabies',
  INSTAGRAM_URL: 'https://www.instagram.com/trustfbabies/'
};


/* Adds a menu to the response spreadsheet. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('TFB QR Check-In')
    .addItem('1. Set staff access code', 'setCheckInPin')
    .addItem('2. Setup check-in system', 'setupQrCheckIn')
    .addItem('3. Set Vercel API shared secret', 'setVercelApiSecret')
    .addSeparator()
    .addItem('Send ticket for selected row (test)', 'sendTicketForSelectedRow')
    .addItem('Send test-format ticket to Sahil (registered row required)', 'sendTestQrEmailToSahil')
    .addItem('Send official functional QR test to Alizar', 'sendOfficialTestTicketToAlizar')
    .addItem('Send all pending tickets', 'sendPendingTickets')
    .addSeparator()
    .addItem('Mark selected payment CONFIRMED', 'markSelectedPaymentConfirmed')
    .addItem('Mark selected payment PENDING', 'markSelectedPaymentPending')
    .addToUi();
}


/* Configure a strong, private code for event staff. */
function setCheckInPin() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.prompt(
    'Set staff access code',
    'Enter a private access code of at least 16 characters. Give it only to authorised check-in staff.',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  const pin = response.getResponseText().trim();

  if (pin.length < 16) {
    ui.alert('Use at least 16 characters, then run this function again.');
    return;
  }

  PropertiesService.getScriptProperties()
    .setProperty('CHECKIN_PIN', pin);

  ui.alert('Staff access code saved.');
}


/* Store the server-to-server secret used by the Vercel API. */
function setVercelApiSecret() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'Set Vercel API shared secret',
    'Paste a randomly generated secret of at least 32 characters. Enter the exact same value in Vercel Environment Variables as TFB_API_SECRET. Do not put it in script.js or GitHub.',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const secret = response.getResponseText().trim();
  if (secret.length < 32) {
    ui.alert('The shared secret must be at least 32 characters. Nothing was saved.');
    return;
  }

  PropertiesService.getScriptProperties().setProperty('TFB_API_SECRET', secret);
  ui.alert('Vercel API shared secret saved in Script Properties. Add the same value to Vercel as TFB_API_SECRET, then redeploy Vercel.');
}


/* One-time setup. Run under trustfbabies@gmail.com. */
function setupQrCheckIn() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(CFG.SHEET_NAME);

  if (!sheet) {
    throw new Error(
      'Could not find the sheet named "' + CFG.SHEET_NAME + '".'
    );
  }

  ensureSystemColumns_(sheet);

  // Remember the spreadsheet ID for web-app executions.
  PropertiesService.getScriptProperties()
    .setProperty('SPREADSHEET_ID', ss.getId());

  // Replace this account's previous trigger for this handler.
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'handleFormSubmit') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Automatically email a QR ticket after each new form submission.
  ScriptApp.newTrigger('handleFormSubmit')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();

  notify_(
    'Setup complete.\n\n' +
    'Ticket columns are ready and the automatic form-submission trigger ' +
    'has been created.'
  );
}


/* Runs automatically for new form submissions. */
function handleFormSubmit(e) {
  if (!e || !e.range) {
    throw new Error(
      'This function runs automatically from a form-submission trigger.'
    );
  }

  const sheet = e.range.getSheet();

  if (sheet.getName() !== CFG.SHEET_NAME) return;

  ensureSystemColumns_(sheet);
  issueTicketForRow_(sheet, e.range.getRow());
}


/*
 * Sends tickets for existing registrations that have not been emailed.
 * Rows already marked SENT are skipped.
 */
function sendPendingTickets() {
  const sheet = getResponseSheet_();
  ensureSystemColumns_(sheet);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (let row = 2; row <= sheet.getLastRow(); row++) {
    const result = issueTicketForRow_(sheet, row);

    if (result === 'SENT') {
      sent++;
    } else if (result === 'SKIPPED') {
      skipped++;
    } else {
      failed++;
    }
  }

  const message =
    'Ticket email run completed.\n\n' +
    'Successfully sent: ' + sent + '\n' +
    'Already sent or skipped: ' + skipped + '\n' +
    'Failed: ' + failed +
    '\n\nCheck TICKET EMAIL STATUS for details.';

  Logger.log(message);
  notify_(message);
}


/* Useful for testing a single selected registration first. */
function sendTicketForSelectedRow() {
  const sheet = SpreadsheetApp.getActiveSheet();

  if (!sheet || sheet.getName() !== CFG.SHEET_NAME) {
    throw new Error(
      'Open the response sheet and select a registration row first.'
    );
  }

  const range = sheet.getActiveRange();

  if (!range || range.getRow() < 2) {
    throw new Error('Select a participant row, not the header row.');
  }

  const result = issueTicketForRow_(sheet, range.getRow());

  notify_('Selected row: ' + range.getRow() + '\nResult: ' + result);
}


/* Manually verify a payment after checking its UTR and payment screenshot. */
function markSelectedPaymentConfirmed() {
  setSelectedPaymentStatus_('CONFIRMED');
}

/* Revoke entry eligibility while payment remains unresolved. */
function markSelectedPaymentPending() {
  setSelectedPaymentStatus_('PENDING');
}

function setSelectedPaymentStatus_(status) {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet || sheet.getName() !== CFG.SHEET_NAME) {
    throw new Error('Open the Form Responses 1 sheet and select a registrant row.');
  }

  const row = sheet.getActiveRange() ? sheet.getActiveRange().getRow() : 0;
  if (row < 2) throw new Error('Select a registrant row, not the header row.');

  const cols = ensureSystemColumns_(sheet);
  const paymentCol = cols[headerKey_(CFG.PAYMENT_STATUS_HEADER)];
  sheet.getRange(row, paymentCol).setValue(status);
  notify_('Payment status for row ' + row + ' set to ' + status + '.');
}


/* Creates a unique ticket and emails its QR image. */
function issueTicketForRow_(sheet, row, forceSend) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const cols = ensureSystemColumns_(sheet);

    if (row < 2 || row > sheet.getLastRow()) {
      return 'SKIPPED';
    }

    const emailCol = cols[headerKey_(CFG.EMAIL_HEADER)];
    const nameCol = cols[headerKey_(CFG.NAME_HEADER)];
    const ticketCol = cols[headerKey_(CFG.TICKET_ID_HEADER)];
    const tokenCol = cols[headerKey_(CFG.TOKEN_HEADER)];
    const statusCol = cols[headerKey_(CFG.EMAIL_STATUS_HEADER)];
    const paymentStatusCol = cols[headerKey_(CFG.PAYMENT_STATUS_HEADER)];

    if (!String(sheet.getRange(row, paymentStatusCol).getDisplayValue()).trim()) {
      sheet.getRange(row, paymentStatusCol).setValue('PENDING');
    }

    const email = String(
      sheet.getRange(row, emailCol).getDisplayValue()
    ).trim();

    const status = String(
      sheet.getRange(row, statusCol).getDisplayValue()
    ).trim().toUpperCase();

    if (status === 'SENT' && !forceSend) {
      return 'SKIPPED';
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      sheet.getRange(row, statusCol)
        .setValue('ERROR: Missing or invalid Column D email');
      return 'ERROR';
    }

    const name = String(
      sheet.getRange(row, nameCol).getDisplayValue()
    ).trim() || 'Participant';

    let ticketId = String(
      sheet.getRange(row, ticketCol).getDisplayValue()
    ).trim();

    let token = String(
      sheet.getRange(row, tokenCol).getDisplayValue()
    ).trim();

    // Reuse existing ticket data when retrying a failed email.
    if (!token) {
      token =
        Utilities.getUuid().replace(/-/g, '') +
        Utilities.getUuid().replace(/-/g, '');
    }

    if (!ticketId) {
      ticketId = 'TFB-' + token.substring(0, 8).toUpperCase();
    }

    // Save the token before sending so a retry uses the same ticket.
    sheet.getRange(row, ticketCol).setValue(ticketId);
    sheet.getRange(row, tokenCol).setValue(token);
    sheet.getRange(row, statusCol).setValue('SENDING');

    try {
      const qrBlob = createQrImage_(token, ticketId);

      const subject = 'Your ' + EVENT.NAME + ' Registration & QR Ticket';

      const transactionCol = cols[headerKey_(CFG.TRANSACTION_HEADER)] || 0;
      const transactionRef = transactionCol
        ? String(sheet.getRange(row, transactionCol).getDisplayValue()).trim()
        : '';

      const paymentCol = cols[headerKey_(CFG.PAYMENT_STATUS_HEADER)];
      const paymentStatus = String(
        sheet.getRange(row, paymentCol).getDisplayValue()
      ).trim().toUpperCase() || 'PENDING';

      const emailContent = buildRegistrationEmail_({
        name: name,
        ticketId: ticketId,
        transactionRef: transactionRef,
        paymentStatus: paymentStatus
      });
      const plainBody = emailContent.plainBody;
      const htmlBody = emailContent.htmlBody;
      // This email is sent from the account running this function/trigger.
      GmailApp.sendEmail(email, subject, plainBody, {
        name: 'Trust Fund Babies',
        htmlBody: htmlBody,
        inlineImages: {
          ticketQr: qrBlob
        }
      });

      sheet.getRange(row, statusCol).setValue('SENT');

      return 'SENT';

    } catch (error) {
      const detail = String(error.message || error).substring(0, 160);

      sheet.getRange(row, statusCol)
        .setValue('ERROR: ' + detail);

      Logger.log('Row ' + row + ': ' + detail);

      return 'ERROR';
    }

  } finally {
    lock.releaseLock();
  }
}


/*
 * Creates a PNG QR image.
 * The QR encodes ONLY the random ticket token, not personal details.
 */
function createQrImage_(token, ticketId) {
  const url =
    'https://quickchart.io/qr?size=360&margin=3&format=png&text=' +
    encodeURIComponent(token);

  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(
      'QR image service returned HTTP ' + response.getResponseCode()
    );
  }

  return response.getBlob()
    .setName(ticketId + '.png')
    .setContentType('image/png');
}


/*
 * Serves the staff camera-scanning page through Apps Script HTML Service.
 * createTemplateFromFile is required because Index.html uses <?!= include(...) ?>.
 */
function doGet(e) {
  if (e && e.parameter && String(e.parameter.action || '').toLowerCase() === 'health') {
    return jsonResponse_({ ok: true, service: 'TFB QR Check-In', timestamp: new Date().toISOString() });
  }

  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('TFB QR Check-In')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* Loads script.html or style.html into the Index template. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/*
 * Authenticated API endpoint for a Vercel serverless function.
 * Set TFB_API_SECRET in Apps Script Script Properties and the same value
 * in Vercel Environment Variables. Never put the secret in browser JS/GitHub.
 */
function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const data = JSON.parse(raw);
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('TFB_API_SECRET');

    const providedSecret = String(data.sharedSecret || data.apiSecret || '');
    if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
      return jsonResponse_({ ok: false, code: 'AUTH_FAILED', message: 'Backend authentication failed.' });
    }

    if (String(data.action || '').toLowerCase() !== 'checkin') {
      return jsonResponse_({ ok: false, code: 'INVALID_ACTION', message: 'Unsupported API action.' });
    }

    const result = checkInTicket(data.token, data.pin);
    return jsonResponse_(result);
  } catch (error) {
    Logger.log('API request failed: ' + (error && error.stack ? error.stack : error));
    return jsonResponse_({ ok: false, code: 'SYSTEM_ERROR', message: 'The check-in request could not be processed.' });
  }
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}


/*
 * Called by the Apps Script scanner page or authenticated Vercel API.
 * Real attendee registrations are checked first. The separate test sheet is
 * checked second, so Alizar's test QR can exercise the scanner without being
 * inserted into or counted as an attendee form response.
 */
function checkInTicket(token, pin) {
  const expectedPin = PropertiesService.getScriptProperties().getProperty('CHECKIN_PIN');

  if (!expectedPin) {
    return { ok: false, code: 'SETUP_REQUIRED', message: 'Staff access code has not been configured.' };
  }
  if (String(pin || '') !== expectedPin) {
    return { ok: false, code: 'AUTH_FAILED', message: 'Incorrect staff access code.' };
  }

  const qrToken = String(token || '').trim();
  if (!qrToken) {
    return { ok: false, code: 'INVALID', message: 'Empty or invalid QR code.' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName(CFG.SHEET_NAME);
    if (!sheet) throw new Error('Missing response sheet: ' + CFG.SHEET_NAME);
    const cols = ensureSystemColumns_(sheet);

    // First check genuine form registrations.
    if (sheet.getLastRow() >= 2) {
      const tokenCol = cols[headerKey_(CFG.TOKEN_HEADER)];
      const tokenValues = sheet.getRange(2, tokenCol, sheet.getLastRow() - 1, 1).getDisplayValues();
      let matchRow = 0;
      for (let i = 0; i < tokenValues.length; i++) {
        if (String(tokenValues[i][0]).trim() === qrToken) {
          matchRow = i + 2;
          break;
        }
      }

      if (matchRow) {
        const statusCol = cols[headerKey_(CFG.EMAIL_STATUS_HEADER)];
        const emailStatus = String(sheet.getRange(matchRow, statusCol).getDisplayValue()).trim().toUpperCase();
        if (emailStatus !== 'SENT') {
          return { ok: false, code: 'NOT_ISSUED', message: 'This ticket has not been issued successfully.' };
        }

        const paymentCol = cols[headerKey_(CFG.PAYMENT_STATUS_HEADER)];
        const paymentStatus = String(sheet.getRange(matchRow, paymentCol).getDisplayValue()).trim().toUpperCase() || 'PENDING';
        if (paymentStatus !== 'CONFIRMED') {
          return {
            ok: false,
            code: 'PAYMENT_PENDING',
            message: 'PAYMENT VERIFICATION PENDING',
            detail: 'Registration found, but entry is blocked until the organiser marks payment CONFIRMED.'
          };
        }

        const name = String(sheet.getRange(matchRow, cols[headerKey_(CFG.NAME_HEADER)]).getDisplayValue()).trim();
        const ticketId = String(sheet.getRange(matchRow, cols[headerKey_(CFG.TICKET_ID_HEADER)]).getDisplayValue()).trim();
        const checkinCol = cols[headerKey_(CFG.CHECKIN_STATUS_HEADER)];
        const timeCol = cols[headerKey_(CFG.CHECKIN_TIME_HEADER)];
        const previousStatus = String(sheet.getRange(matchRow, checkinCol).getDisplayValue()).trim().toUpperCase();
        const previousTime = sheet.getRange(matchRow, timeCol).getValue();

        if (previousStatus === 'CHECKED IN') {
          return {
            ok: false, code: 'ALREADY_USED', message: 'ALREADY CHECKED IN',
            name: name, ticketId: ticketId, checkedAt: formatCheckinTime_(previousTime)
          };
        }

        const now = new Date();
        sheet.getRange(matchRow, checkinCol).setValue('CHECKED IN');
        sheet.getRange(matchRow, timeCol).setValue(now);
        SpreadsheetApp.flush();
        return {
          ok: true, code: 'SUCCESS', message: 'CHECK-IN SUCCESSFUL',
          name: name, ticketId: ticketId, checkedAt: formatCheckinTime_(now), testTicket: false
        };
      }
    }

    // If not a real attendee token, check the isolated functional-test register.
    const testResult = checkInTestTicket_(ss, qrToken);
    if (testResult) return testResult;

    return { ok: false, code: 'INVALID', message: 'INVALID QR TICKET' };

  } catch (error) {
    Logger.log('Check-in error: ' + (error && error.stack ? error.stack : error));
    return { ok: false, code: 'SYSTEM_ERROR', message: 'System error. Contact the event lead.' };
  } finally {
    lock.releaseLock();
  }
}

/* Validates and consumes a QR token held in the isolated TFB Test Tickets tab. */
function checkInTestTicket_(ss, qrToken) {
  const testSheet = ss.getSheetByName('TFB Test Tickets');
  if (!testSheet || testSheet.getLastRow() < 2) return null;

  const testCols = getTestTicketColumnMap_(testSheet);
  const tokenCol = testCols.TOKEN;
  const tokenValues = testSheet.getRange(2, tokenCol, testSheet.getLastRow() - 1, 1).getDisplayValues();
  let row = 0;

  for (let i = 0; i < tokenValues.length; i++) {
    if (String(tokenValues[i][0]).trim() === qrToken) {
      row = i + 2;
      break;
    }
  }
  if (!row) return null;

  const emailStatus = String(testSheet.getRange(row, testCols.EMAIL_STATUS).getDisplayValue()).trim().toUpperCase();
  if (emailStatus !== 'SENT') {
    return { ok: false, code: 'NOT_ISSUED', message: 'This test ticket has not been emailed successfully.' };
  }

  const currentStatus = String(testSheet.getRange(row, testCols.CHECKIN_STATUS).getDisplayValue()).trim().toUpperCase();
  const name = String(testSheet.getRange(row, testCols.NAME).getDisplayValue()).trim();
  const ticketId = String(testSheet.getRange(row, testCols.TICKET_ID).getDisplayValue()).trim();
  const previousTime = testSheet.getRange(row, testCols.CHECKIN_TIME).getValue();

  if (currentStatus === 'CHECKED IN') {
    return {
      ok: false,
      code: 'ALREADY_USED',
      message: 'TEST QR ALREADY SCANNED — TEST RECORD ONLY',
      detail: 'This is an internal test ticket, not an attendee pass.',
      name: name,
      ticketId: ticketId,
      checkedAt: formatCheckinTime_(previousTime),
      testTicket: true
    };
  }

  const now = new Date();
  testSheet.getRange(row, testCols.CHECKIN_STATUS).setValue('CHECKED IN');
  testSheet.getRange(row, testCols.CHECKIN_TIME).setValue(now);
  SpreadsheetApp.flush();

  return {
    ok: true,
    code: 'SUCCESS',
    message: 'TEST CHECK-IN SUCCESSFUL — TEST RECORD ONLY',
    detail: 'The scanner and spreadsheet connection worked. This test record is not an attendee registration or admission pass.',
    name: name,
    ticketId: ticketId,
    checkedAt: formatCheckinTime_(now),
    testTicket: true
  };
}

/* Spreadsheet and column helpers. */

function getSpreadsheet_() {
  const properties = PropertiesService.getScriptProperties();

  const configuredId =
    String(SPREADSHEET_ID || '').trim() ||
    String(properties.getProperty('SPREADSHEET_ID') || '').trim();

  let ss = configuredId
    ? SpreadsheetApp.openById(configuredId)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error(
      'Spreadsheet not found. Open this script from the response sheet ' +
      'using Extensions > Apps Script, or set SPREADSHEET_ID in Code.gs.'
    );
  }

  properties.setProperty('SPREADSHEET_ID', ss.getId());

  return ss;
}


function getResponseSheet_() {
  const sheet = getSpreadsheet_().getSheetByName(CFG.SHEET_NAME);

  if (!sheet) {
    throw new Error('Missing response sheet: ' + CFG.SHEET_NAME);
  }

  return sheet;
}


function ensureSystemColumns_(sheet) {
  const requiredHeaders = [
    CFG.TICKET_ID_HEADER,
    CFG.TOKEN_HEADER,
    CFG.EMAIL_STATUS_HEADER,
    CFG.CHECKIN_STATUS_HEADER,
    CFG.CHECKIN_TIME_HEADER,
    CFG.PAYMENT_STATUS_HEADER
  ];

  const lastCol = Math.max(sheet.getLastColumn(), 1);

  const currentHeaders = sheet
    .getRange(1, 1, 1, lastCol)
    .getDisplayValues()[0];

  const existing = new Set(
    currentHeaders.map(function(header) {
      return headerKey_(header);
    })
  );

  requiredHeaders.forEach(function(header) {
    if (!existing.has(headerKey_(header))) {
      const newColumn = sheet.getLastColumn() + 1;
      sheet.getRange(1, newColumn).setValue(header);
      existing.add(headerKey_(header));

      // New payment-status cells default to PENDING until the organiser
      // verifies the transaction reference and uploaded payment screenshot.
      if (headerKey_(header) === headerKey_(CFG.PAYMENT_STATUS_HEADER)) {
        const lastRow = sheet.getLastRow();
        if (lastRow >= 2) {
          sheet.getRange(2, newColumn, lastRow - 1, 1)
            .setValues(Array.from({length: lastRow - 1}, () => ['PENDING']));
        }
      }
    }
  });

  const cols = getColumnMap_(sheet);

  if (!cols[headerKey_(CFG.NAME_HEADER)] ||
      !cols[headerKey_(CFG.EMAIL_HEADER)]) {
    throw new Error(
      'Required headers not found: FULL NAME and EMAIL ADDRESS. ' +
      'Check the first row of Form Responses 1.'
    );
  }

  return cols;
}


function getColumnMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet
    .getRange(1, 1, 1, lastCol)
    .getDisplayValues()[0];

  const map = {};

  headers.forEach(function(header, index) {
    const key = headerKey_(header);
    // The Google Form response sheet has two similar email columns:
    // Column B is the signed-in Google account and Column D is the attendee's
    // manually entered EMAIL ADDRESS. We intentionally keep the RIGHTMOST
    // matching header so tickets go to Column D, not the form-owner account.
    if (key) map[key] = index + 1;
  });

  return map;
}


function headerKey_(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}


function escapeHtml_(value) {
  const replacements = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  return String(value).replace(/[&<>"']/g, function(character) {
    return replacements[character];
  });
}


function formatCheckinTime_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(
      value,
      Session.getScriptTimeZone(),
      'dd MMM yyyy, hh:mm:ss a'
    );
  }

  return value ? String(value) : '';
}


function notify_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    Logger.log(message);
  }
}

/**
 * Sends the same real-looking confirmation + QR email to Sahil for preview.
 * This requires Sahil's email to be present in the EMAIL ADDRESS column.
 * It reuses that registration's real ticket token, so it can be verified
 * by the scanner; the scanner will still block entry if payment is PENDING.
 */
function sendTestQrEmailToSahil() {
  const sheet = getResponseSheet_();
  const cols = ensureSystemColumns_(sheet);
  const emailCol = cols[headerKey_(CFG.EMAIL_HEADER)];
  let matchingRow = 0;

  for (let row = 2; row <= sheet.getLastRow(); row++) {
    const email = String(sheet.getRange(row, emailCol).getDisplayValue())
      .trim().toLowerCase();
    if (email === 'sahilsharma361004@gmail.com') {
      matchingRow = row;
      break;
    }
  }

  if (!matchingRow) {
    throw new Error(
      'No registration was found for sahilsharma361004@gmail.com in the EMAIL ADDRESS column. ' +
      'Submit the form with this address first; then run this function again.'
    );
  }

  const result = issueTicketForRow_(sheet, matchingRow, true);
  notify_(
    result === 'SENT'
      ? 'The realistic registration + QR email was sent to Sahil using his registered ticket.'
      : 'Email result: ' + result + '. Check TICKET EMAIL STATUS and Executions for details.'
  );
}


/**
 * Builds the same minimal, realistic email for both actual attendees and the
 * Sahil preview. Event details appear before the QR code as requested.
 */
function buildRegistrationEmail_(data) {
  const name = escapeHtml_(data.name || 'Participant');
  const ticketId = escapeHtml_(data.ticketId || '');
  const transactionRef = escapeHtml_(data.transactionRef || 'Not provided');
  const paymentStatus = String(data.paymentStatus || 'PENDING').toUpperCase();
  const paymentConfirmed = paymentStatus === 'CONFIRMED';
  const isTest = data.isTest === true;
  const paymentTitle = isTest
    ? 'INTERNAL SYSTEM TEST — NOT A PAYMENT CONFIRMATION'
    : (paymentConfirmed ? 'PAYMENT VERIFIED' : 'PAYMENT VERIFICATION PENDING');
  const paymentMessage = isTest
    ? 'This email tests the official registration layout and QR check-in connection. The QR is linked to a separate internal test record. No payment has been received or verified, and this is not an attendee admission pass.'
    : (paymentConfirmed
      ? 'Your payment has been verified. Keep this email and present the QR below at entry.'
      : 'We have received your registration. Our team will verify your transaction reference and payment screenshot. Entry is approved only after successful payment verification.');
  const qrHeading = isTest ? 'QR SYSTEM TEST TICKET' : 'YOUR QR TICKET';
  const qrInstruction = isTest
    ? 'This QR is a functional scanner test linked to the separate TFB Test Tickets sheet. It is not an attendee pass and does not grant event admission.'
    : (paymentConfirmed
      ? 'Keep this QR private and show it to the authorised entry team. Your payment is verified; your ticket is eligible for check-in.'
      : 'Keep this QR private and show it to the authorised entry team. This QR will not be accepted at entry until your payment is marked CONFIRMED by the organiser.');

  const plainBody =
    'TRUST FUND BABIES — EVENT REGISTRATION\n\n' +
    'Registration received, ' + (data.name || 'Participant') + '.\n' +
    'Thank you for registering for ' + EVENT.NAME + '.\n\n' +
    'YOUR EVENT DETAILS\n' +
    'Guest name: ' + (data.name || 'Participant') + '\n' +
    'Event: ' + EVENT.NAME + '\n' +
    'Date: ' + EVENT.DATE + '\n' +
    'Venue: ' + EVENT.VENUE + '\n' +
    'Entry: ' + EVENT.ENTRY_TIME + '\n' +
    'Pass price: ' + EVENT.PASS_PRICE + '\n' +
    'Transaction reference: ' + (data.transactionRef || 'Not provided') + '\n\n' +
    paymentTitle + '\n' + paymentMessage + '\n\n' +
    qrHeading + '\n' +
    'Ticket ID: ' + (data.ticketId || '') + '\n' +
    qrInstruction + '\n\n' +
    'Follow ' + EVENT.INSTAGRAM_LABEL + ': ' + EVENT.INSTAGRAM_URL + '\n\n' +
    'TFB — TRUST FUND BABIES\n' +
    'All confirmed passes are non-refundable. Please retain your transaction reference.';

  const pink = '#f02e9d';
  const paymentBg = paymentConfirmed ? '#effaf3' : '#fff3f8';
  const paymentColor = paymentConfirmed ? '#137a3c' : '#b31665';
  const safeInstagramUrl = EVENT.INSTAGRAM_URL;

  const htmlBody = `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml_(EVENT.NAME)} — Registration</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#19131a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Your registration details and unique QR ticket for ${escapeHtml_(EVENT.NAME)}.
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f4f6;padding:20px 8px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border-collapse:separate;border-spacing:0;">
          <tr>
            <td style="padding:20px 24px;background:#171018;border-bottom:4px solid ${pink};">
              <div style="font-size:16px;font-weight:800;letter-spacing:2px;color:${pink};">TRUST FUND BABIES</div>
              <div style="font-size:11px;letter-spacing:1.5px;color:#f8edf4;margin-top:5px;">EVENT REGISTRATION</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;background:#fff7fb;">
              <div style="font-size:11px;font-weight:800;letter-spacing:2px;color:${pink};">REGISTRATION RECEIVED</div>
              <h1 style="margin:10px 0 10px;font-size:25px;line-height:1.25;color:#211521;">You're registered, ${name}.</h1>
              <p style="margin:0;font-size:15px;line-height:1.65;color:#403640;">
                Thank you for registering for <strong style="color:${pink};">${escapeHtml_(EVENT.NAME)}</strong>.
                Your registration details are below.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 24px 14px;">
              <h2 style="margin:0 0 14px;font-size:15px;letter-spacing:.3px;color:#211521;">YOUR EVENT DETAILS</h2>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-size:14px;">
                ${emailDetailRow_('Guest name', name)}
                ${emailDetailRow_('Event', escapeHtml_(EVENT.NAME))}
                ${emailDetailRow_('Date', escapeHtml_(EVENT.DATE))}
                ${emailDetailRow_('Venue', escapeHtml_(EVENT.VENUE))}
                ${emailDetailRow_('Entry', escapeHtml_(EVENT.ENTRY_TIME))}
                ${emailDetailRow_('Pass price', '<strong style="color:' + pink + ';">' + escapeHtml_(EVENT.PASS_PRICE) + '</strong>')}
                ${emailDetailRow_('Transaction ref.', transactionRef)}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 20px;">
              <div style="padding:14px 16px;border-left:4px solid ${pink};background:${paymentBg};">
                <div style="font-size:12px;font-weight:800;letter-spacing:.7px;color:${paymentColor};">${paymentTitle}</div>
                <p style="margin:7px 0 0;font-size:13px;line-height:1.6;color:#403640;">${paymentMessage}</p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;">
              <div style="border:1px solid #eadfe7;border-radius:10px;padding:18px;text-align:center;">
                <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;color:${pink};">${qrHeading}</div>
                <div style="margin-top:8px;font-size:13px;color:#635663;">Ticket ID: <strong style="color:#211521;">${ticketId}</strong></div>
                <img src="cid:ticketQr" width="220" height="220" alt="Your unique registration QR code" style="display:block;width:220px;height:220px;max-width:100%;margin:14px auto 8px;border:0;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#635663;">
                  ${qrInstruction}
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;">
              <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#403640;">See you at the sundowner.</p>
              <a href="${safeInstagramUrl}" style="display:inline-block;padding:10px 15px;background:${pink};border-radius:4px;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;">Follow ${EVENT.INSTAGRAM_LABEL}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:17px 24px;background:#171018;border-top:3px solid ${pink};">
              <div style="font-size:12px;font-weight:800;letter-spacing:.6px;color:${pink};">TFB — TRUST FUND BABIES</div>
              <p style="margin:8px 0 0;font-size:11px;line-height:1.6;color:#f4eaf2;">
                Please retain your transaction reference. All confirmed passes are non-refundable.
              </p>
            </td>
          </tr>
        </table>
        <p style="max-width:560px;margin:12px auto 0;font-size:10px;line-height:1.5;color:#777;text-align:center;">
          This is an automated registration acknowledgement. Payment status is shown above.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {plainBody: plainBody, htmlBody: htmlBody};
}


function emailDetailRow_(label, valueHtml) {
  return '<tr>' +
    '<td style="width:38%;padding:9px 0;border-bottom:1px solid #eee3eb;color:#776b76;vertical-align:top;">' +
    escapeHtml_(label) + '</td>' +
    '<td style="padding:9px 0;border-bottom:1px solid #eee3eb;color:#211521;vertical-align:top;">' +
    valueHtml + '</td>' +
    '</tr>';
}

/**
 * Sends one official-style TFB email to Alizar with a FUNCTIONAL test QR.
 * The test ticket is stored in a separate "TFB Test Tickets" sheet, not in
 * the Google Form responses. checkInTicket() knows how to validate that sheet.
 * The email is visually consistent with the real attendee email, but clearly
 * states that it is a system test and not proof of payment or admission.
 * This function sends only to the fixed address below.
 */
function sendOfficialTestTicketToAlizar() {
  const recipient = 'alizarkhan6@gmail.com';
  const guestName = 'Alizar Khan';
  const testSheet = ensureTestTicketSheet_();
  const cols = getTestTicketColumnMap_(testSheet);
  const testKey = 'ALIZAR_EMAIL_QR_TEST';
  let row = 0;

  // Reuse one dedicated test row; never write into the Form Responses tab.
  if (testSheet.getLastRow() >= 2) {
    const keys = testSheet.getRange(2, cols.TEST_KEY, testSheet.getLastRow() - 1, 1).getDisplayValues();
    const emails = testSheet.getRange(2, cols.EMAIL, testSheet.getLastRow() - 1, 1).getDisplayValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === testKey && String(emails[i][0]).trim().toLowerCase() === recipient) {
        row = i + 2;
        break;
      }
    }
  }
  if (!row) row = testSheet.getLastRow() + 1;

  // A fresh token is issued each time this test function is run.
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const ticketId = 'TFB-TEST-' + token.substring(0, 8).toUpperCase();
  const now = new Date();

  testSheet.getRange(row, cols.TEST_KEY).setValue(testKey);
  testSheet.getRange(row, cols.NAME).setValue(guestName);
  testSheet.getRange(row, cols.EMAIL).setValue(recipient);
  testSheet.getRange(row, cols.TICKET_ID).setValue(ticketId);
  testSheet.getRange(row, cols.TOKEN).setValue(token);
  testSheet.getRange(row, cols.EMAIL_STATUS).setValue('SENDING');
  testSheet.getRange(row, cols.PAYMENT_STATUS).setValue('TEST ONLY — NO PAYMENT');
  testSheet.getRange(row, cols.CHECKIN_STATUS).clearContent();
  testSheet.getRange(row, cols.CHECKIN_TIME).clearContent();
  testSheet.getRange(row, cols.CREATED_AT).setValue(now);
  SpreadsheetApp.flush();

  try {
    const qrBlob = createQrImage_(token, ticketId);
    const email = buildRegistrationEmail_({
      name: guestName,
      ticketId: ticketId,
      transactionRef: 'INTERNAL TEST — NO PAYMENT RECORD',
      paymentStatus: 'TEST',
      isTest: true
    });

    const subject = 'DDLJ Diwali Sundowner — Registration & QR Ticket';
    GmailApp.sendEmail(recipient, subject, email.plainBody, {
      name: 'Trust Fund Babies',
      htmlBody: email.htmlBody,
      inlineImages: { ticketQr: qrBlob }
    });

    testSheet.getRange(row, cols.EMAIL_STATUS).setValue('SENT');
    SpreadsheetApp.flush();
    Logger.log('Functional TFB test ticket sent only to ' + recipient + ' | ' + ticketId);
    notify_('Official-style email with a functional TEST QR sent only to ' + recipient + '. Scan it using the Apps Script scanner. It will show TEST CHECK-IN and will not create an attendee entry.');
    return 'SENT';

  } catch (error) {
    const detail = String(error && error.message ? error.message : error).substring(0, 180);
    testSheet.getRange(row, cols.EMAIL_STATUS).setValue('ERROR: ' + detail);
    SpreadsheetApp.flush();
    Logger.log('Alizar test email failed: ' + detail);
    throw error;
  }
}

/* Create or open the isolated functional-test register. */
function ensureTestTicketSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName('TFB Test Tickets');
  const headers = [
    'TEST KEY', 'FULL NAME', 'EMAIL ADDRESS', 'QR TICKET ID', 'QR TOKEN',
    'TICKET EMAIL STATUS', 'PAYMENT STATUS', 'CHECK-IN STATUS', 'CHECK-IN TIME', 'CREATED AT'
  ];

  if (!sheet) sheet = ss.insertSheet('TFB Test Tickets');
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    const currentWidth = Math.max(sheet.getLastColumn(), 1);
    const current = sheet.getRange(1, 1, 1, currentWidth).getDisplayValues()[0];
    const seen = {};
    current.forEach((h, i) => { if (headerKey_(h)) seen[headerKey_(h)] = i + 1; });
    headers.forEach((h) => {
      if (!seen[headerKey_(h)]) {
        const nextCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, nextCol).setValue(h).setFontWeight('bold');
        seen[headerKey_(h)] = nextCol;
      }
    });
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/* Returns 1-based column indexes for the test-ticket register. */
function getTestTicketColumnMap_(sheet) {
  const headerMap = getColumnMap_(sheet);
  const required = {
    TEST_KEY: 'TEST KEY', NAME: 'FULL NAME', EMAIL: 'EMAIL ADDRESS',
    TICKET_ID: 'QR TICKET ID', TOKEN: 'QR TOKEN', EMAIL_STATUS: 'TICKET EMAIL STATUS',
    PAYMENT_STATUS: 'PAYMENT STATUS', CHECKIN_STATUS: 'CHECK-IN STATUS',
    CHECKIN_TIME: 'CHECK-IN TIME', CREATED_AT: 'CREATED AT'
  };
  const result = {};
  Object.keys(required).forEach((key) => {
    result[key] = headerMap[headerKey_(required[key])];
    if (!result[key]) throw new Error('Missing test-ticket header: ' + required[key]);
  });
  return result;
}

/* Backwards-compatible menu/function alias for the older preview name. */
function sendPreviewEmailToAlizar() {
  return sendOfficialTestTicketToAlizar();
}
