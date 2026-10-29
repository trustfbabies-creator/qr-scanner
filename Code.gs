
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
  CHECKIN_TIME_HEADER: 'CHECK-IN TIME'
};


/* Adds a menu to the response spreadsheet. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('TFB QR Check-In')
    .addItem('1. Set staff access code', 'setCheckInPin')
    .addItem('2. Setup check-in system', 'setupQrCheckIn')
    .addSeparator()
    .addItem('Send ticket for selected row (test)', 'sendTicketForSelectedRow')
    .addItem('Send all pending tickets', 'sendPendingTickets')
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


/* Creates a unique ticket and emails its QR image. */
function issueTicketForRow_(sheet, row) {
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

    const email = String(
      sheet.getRange(row, emailCol).getDisplayValue()
    ).trim();

    const status = String(
      sheet.getRange(row, statusCol).getDisplayValue()
    ).trim().toUpperCase();

    if (status === 'SENT') {
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

      const subject =
        'Your HOUSE001 Early Bird Registration QR Ticket';

      const plainBody =
        'Hello ' + name + ',\n\n' +
        'Your registration QR ticket is ready.\n\n' +
        'Ticket ID: ' + ticketId + '\n\n' +
        'Show the QR code in this email to the event check-in staff.\n' +
        'Keep your ticket private and do not share it with other attendees.\n\n' +
        'Regards,\nTrust Fund Babies';

      const htmlBody = `
        <div style="font-family:Arial,sans-serif;color:#222;max-width:560px;margin:auto;">
          <h2 style="margin-bottom:4px;">HOUSE001</h2>
          <p style="color:#666;margin-top:0;">EARLY BIRD REGISTRATION</p>

          <p>Hello ${escapeHtml_(name)},</p>

          <p>Your registration QR ticket is ready.</p>

          <div style="padding:18px;border:1px solid #ddd;border-radius:12px;text-align:center;">
            <p style="margin:0 0 8px;"><b>YOUR ENTRY TICKET</b></p>
            <p style="color:#555;">Ticket ID: ${escapeHtml_(ticketId)}</p>
            <img src="cid:ticketQr"
              alt="Your unique QR ticket"
              width="280"
              height="280"
              style="max-width:100%;height:auto;">
            <p style="font-size:13px;color:#666;">
              Present this QR code to the authorised check-in staff.
            </p>
          </div>

          <p><b>Important:</b> This ticket is unique to your registration.
          Do not share or reuse it.</p>

          <p>Regards,<br><b>Trust Fund Babies</b></p>
        </div>
      `;

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


/* Serves the staff camera-scanning page. */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('TFB QR Check-In')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}


/*
 * Called by the scanner page.
 * Requires the private staff access code and prevents duplicate check-ins.
 */
function checkInTicket(token, pin) {
  const expectedPin = PropertiesService.getScriptProperties()
    .getProperty('CHECKIN_PIN');

  if (!expectedPin) {
    return {
      ok: false,
      code: 'SETUP_REQUIRED',
      message: 'Staff access code has not been configured.'
    };
  }

  if (String(pin || '') !== expectedPin) {
    return {
      ok: false,
      code: 'AUTH_FAILED',
      message: 'Incorrect staff access code.'
    };
  }

  const qrToken = String(token || '').trim();

  if (!qrToken) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'Empty or invalid QR code.'
    };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    const sheet = getResponseSheet_();
    const cols = ensureSystemColumns_(sheet);

    if (sheet.getLastRow() < 2) {
      return {
        ok: false,
        code: 'INVALID',
        message: 'No registrations found.'
      };
    }

    const tokenCol = cols[headerKey_(CFG.TOKEN_HEADER)];
    const statusCol = cols[headerKey_(CFG.EMAIL_STATUS_HEADER)];
    const checkinCol = cols[headerKey_(CFG.CHECKIN_STATUS_HEADER)];
    const timeCol = cols[headerKey_(CFG.CHECKIN_TIME_HEADER)];
    const nameCol = cols[headerKey_(CFG.NAME_HEADER)];
    const ticketCol = cols[headerKey_(CFG.TICKET_ID_HEADER)];

    const tokenValues = sheet.getRange(
      2, tokenCol, sheet.getLastRow() - 1, 1
    ).getDisplayValues();

    let matchIndex = -1;

    for (let i = 0; i < tokenValues.length; i++) {
      if (String(tokenValues[i][0]).trim() === qrToken) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex === -1) {
      return {
        ok: false,
        code: 'INVALID',
        message: 'INVALID QR TICKET'
      };
    }

    const row = matchIndex + 2;

    const emailStatus = String(
      sheet.getRange(row, statusCol).getDisplayValue()
    ).trim().toUpperCase();

    if (emailStatus !== 'SENT') {
      return {
        ok: false,
        code: 'NOT_ISSUED',
        message: 'This ticket has not been issued successfully.'
      };
    }

    const name = String(
      sheet.getRange(row, nameCol).getDisplayValue()
    ).trim();

    const ticketId = String(
      sheet.getRange(row, ticketCol).getDisplayValue()
    ).trim();

    const previousStatus = String(
      sheet.getRange(row, checkinCol).getDisplayValue()
    ).trim().toUpperCase();

    const previousTime = sheet.getRange(row, timeCol).getValue();

    if (previousStatus === 'CHECKED IN') {
      return {
        ok: false,
        code: 'ALREADY_USED',
        message: 'ALREADY CHECKED IN',
        name: name,
        ticketId: ticketId,
        checkedAt: formatCheckinTime_(previousTime)
      };
    }

    const now = new Date();

    sheet.getRange(row, checkinCol).setValue('CHECKED IN');
    sheet.getRange(row, timeCol).setValue(now);

    return {
      ok: true,
      code: 'SUCCESS',
      message: 'CHECK-IN SUCCESSFUL',
      name: name,
      ticketId: ticketId,
      checkedAt: formatCheckinTime_(now)
    };

  } catch (error) {
    Logger.log('Check-in error: ' + error.message);

    return {
      ok: false,
      code: 'SYSTEM_ERROR',
      message: 'System error. Contact the event lead.'
    };

  } finally {
    lock.releaseLock();
  }
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
    CFG.CHECKIN_TIME_HEADER
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

function sendTestQrEmailToSahil() {
  const recipient = 'sahilsharma361004@gmail.com';

  // Generate a unique token for this email test.
  const token =
    Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '');

  const ticketId =
    'TFB-TEST-' + token.substring(0, 8).toUpperCase();

  // Use the QR-generation function already in Code.gs.
  const qrBlob = createQrImage_(token, ticketId);

  const subject = 'TFB QR Ticket - Email Delivery Test';

  const plainBody =
    'Hello Sahil,\n\n' +
    'This is a test of the Trust Fund Babies QR-ticket email system.\n\n' +
    'Test Ticket ID: ' + ticketId + '\n\n' +
    'This QR is for testing email delivery only. ' +
    'It is not a valid event-entry ticket.\n\n' +
    'Trust Fund Babies';

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#222;">
      <h2>TRUST FUND BABIES</h2>
      <p>QR TICKET SYSTEM TEST</p>
      <hr>
      <p>Hello Sahil,</p>
      <p>This is a test email to verify that the QR-ticket system is working.</p>
      <div style="border:1px solid #ddd;border-radius:12px;padding:20px;text-align:center;">
        <h3>TEST QR CODE</h3>
        <p><b>Ticket ID:</b> ${ticketId}</p>
        <img src="cid:testQr" width="280" height="280"
             alt="Test QR code" style="max-width:100%;height:auto;">
        <p style="color:#b3261e;font-weight:bold;">
          TEST ONLY — NOT VALID FOR EVENT ENTRY
        </p>
      </div>
      <p>Trust Fund Babies</p>
    </div>
  `;

  GmailApp.sendEmail(recipient, subject, plainBody, {
    name: 'Trust Fund Babies',
    htmlBody: htmlBody,
    inlineImages: {
      testQr: qrBlob
    }
  });

  console.log('Test QR email sent to ' + recipient);
}
