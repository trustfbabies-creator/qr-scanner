
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
  INSTAGRAM_URL: 'https://www.instagram.com/trustfundbabies/'
};


/* Adds a menu to the response spreadsheet. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('TFB QR Check-In')
    .addItem('1. Set staff access code', 'setCheckInPin')
    .addItem('2. Setup check-in system', 'setupQrCheckIn')
    .addSeparator()
    .addItem('Send ticket for selected row (test)', 'sendTicketForSelectedRow')
    .addItem('Send test-format ticket to Sahil (registered row required)', 'sendTestQrEmailToSahil')
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


/* Serves the staff camera-scanning page. */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('TFB QR Check-In')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
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

    const paymentStatusCol = cols[headerKey_(CFG.PAYMENT_STATUS_HEADER)];
    const paymentStatus = String(
      sheet.getRange(row, paymentStatusCol).getDisplayValue()
    ).trim().toUpperCase() || 'PENDING';

    if (paymentStatus !== 'CONFIRMED') {
      return {
        ok: false,
        code: 'PAYMENT_PENDING',
        message: 'PAYMENT VERIFICATION PENDING',
        detail: 'Registration found, but entry is blocked until the organiser marks payment CONFIRMED.'
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
  const paymentTitle = paymentConfirmed
    ? 'PAYMENT VERIFIED'
    : 'PAYMENT VERIFICATION PENDING';
  const paymentMessage = paymentConfirmed
    ? 'Your payment has been verified. Keep this email and present the QR below at entry.'
    : 'We have received your registration. Our team will verify your transaction reference and payment screenshot. Entry is approved only after successful payment verification.';

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
    'YOUR QR TICKET\n' +
    'Ticket ID: ' + (data.ticketId || '') + '\n' +
    'Present the QR image in this email to the authorised entry staff. Keep it private and do not share it.\n\n' +
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
                <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;color:${pink};">YOUR QR TICKET</div>
                <div style="margin-top:8px;font-size:13px;color:#635663;">Ticket ID: <strong style="color:#211521;">${ticketId}</strong></div>
                <img src="cid:ticketQr" width="220" height="220" alt="Your unique registration QR code" style="display:block;width:220px;height:220px;max-width:100%;margin:14px auto 8px;border:0;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#635663;">
                  Keep this QR private and show it to the authorised entry team.
                  ${paymentConfirmed ? 'Your payment is verified; your ticket is eligible for check-in.' : 'This QR will not be accepted at entry until your payment is marked CONFIRMED by the organiser.'}
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
