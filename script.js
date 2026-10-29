/*
 * Trust Fund Babies — QR check-in front-end
 *
 * IMPORTANT:
 * This version calls the existing Apps Script function `checkInTicket(token, pin)`
 * through google.script.run. It must be served by Google Apps Script HTML Service.
 * It will NOT be able to access the private Sheet if served directly from GitHub Pages.
 */

(() => {
  'use strict';

  const state = {
    scanner: null,
    cameraActive: false,
    processing: false,
    pin: '',
    recentScans: [],
    scanLimit: 10
  };

  const $ = (id) => document.getElementById(id);

  const ui = {};

  function bindElements() {
    [
      'system-status', 'system-status-text', 'staff-pin', 'toggle-pin',
      'start-scanner', 'stop-scanner', 'qr-reader', 'scanner-caption',
      'result-card', 'result-symbol', 'result-label', 'result-title',
      'result-message', 'ticket-details', 'ticket-name', 'ticket-id',
      'checkin-time', 'manual-ticket-form', 'manual-token',
      'verify-manual-ticket', 'scan-count', 'recent-scans-body'
    ].forEach((id) => { ui[id] = $(id); });

    const missing = Object.keys(ui).filter((id) => !ui[id]);
    if (missing.length) {
      console.error('TFB QR Check-In: missing HTML element IDs:', missing);
      throw new Error('The page HTML does not match the scanner script.');
    }
  }

  function hasAppsScriptBridge() {
    return Boolean(
      window.google &&
      window.google.script &&
      window.google.script.run
    );
  }

  function setSystemStatus(message, online = false) {
    ui['system-status-text'].textContent = message;
    ui['system-status'].classList.toggle('is-connected', online);
    ui['system-status'].classList.toggle('is-disconnected', !online);
  }

  function setButtonBusy(button, busy, busyText, normalText) {
    if (!button) return;
    button.disabled = Boolean(busy);
    if (busyText && normalText) {
      button.textContent = busy ? busyText : normalText;
    }
  }

  function renderResult(result = {}) {
    const code = String(result.code || 'SYSTEM_ERROR').toUpperCase();
    const success = code === 'SUCCESS';
    const duplicate = code === 'ALREADY_USED';
    const idle = code === 'READY';

    ui['result-card'].classList.remove('is-idle', 'is-success', 'is-warning', 'is-error');
    ui['result-card'].classList.add(
      idle ? 'is-idle' : success ? 'is-success' : duplicate ? 'is-warning' : 'is-error'
    );

    ui['result-symbol'].textContent = success ? '✓' : duplicate ? '!' : idle ? '—' : '×';
    ui['result-label'].textContent = success
      ? 'ENTRY APPROVED'
      : duplicate
        ? 'DUPLICATE ENTRY'
        : idle
          ? 'READY TO SCAN'
          : 'ENTRY NOT APPROVED';

    ui['result-title'].textContent = result.message || 'Waiting for a ticket';
    ui['result-message'].textContent = result.detail || defaultMessageFor(code);

    const hasTicketDetails = Boolean(result.name || result.ticketId || result.checkedAt);
    ui['ticket-details'].hidden = !hasTicketDetails;
    ui['ticket-name'].textContent = result.name || '—';
    ui['ticket-id'].textContent = result.ticketId || '—';
    ui['checkin-time'].textContent = result.checkedAt || '—';
  }

  function defaultMessageFor(code) {
    switch (code) {
      case 'SUCCESS':
        return 'The ticket is valid and this entry has been recorded.';
      case 'ALREADY_USED':
        return 'This ticket was checked in earlier. Do not admit a second time using this ticket.';
      case 'INVALID':
        return 'No matching issued ticket was found. Do not admit the attendee until staff verify the registration.';
      case 'NOT_ISSUED':
        return 'The ticket has not been successfully issued by the registration system.';
      case 'AUTH_FAILED':
        return 'The staff access code is incorrect. Re-enter it and try again.';
      case 'SETUP_REQUIRED':
        return 'The staff access code or Apps Script setup is missing. Contact the system administrator.';
      default:
        return 'The ticket could not be verified. Check the connection and try again.';
    }
  }

  function callCheckInBackend(token, pin) {
    return new Promise((resolve, reject) => {
      if (!hasAppsScriptBridge()) {
        reject(new Error(
          'Apps Script connection is unavailable. This page must be served through Google Apps Script HTML Service; a GitHub Pages page cannot use google.script.run directly.'
        ));
        return;
      }

      try {
        window.google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler((error) => {
            reject(new Error(error && error.message ? error.message : 'Apps Script request failed.'));
          })
          .checkInTicket(token, pin);
      } catch (error) {
        reject(error);
      }
    });
  }

  async function verifyTicket(token, source = 'camera') {
    const cleanToken = String(token || '').trim();

    if (!cleanToken) {
      renderResult({
        code: 'INVALID',
        message: 'No ticket token provided',
        detail: 'Scan a QR code or paste its token into the manual field.'
      });
      return;
    }

    state.pin = ui['staff-pin'].value.trim();
    if (state.pin.length < 16) {
      renderResult({
        code: 'AUTH_FAILED',
        message: 'Staff access code required',
        detail: 'Enter the access code configured by the event administrator. It must be at least 16 characters.'
      });
      return;
    }

    state.processing = true;
    setButtonBusy(ui['verify-manual-ticket'], true, 'Verifying…', 'Verify ticket');
    renderResult({
      code: 'READY',
      message: 'Verifying ticket…',
      detail: 'Checking the registration sheet. Do not scan another ticket yet.'
    });

    try {
      const result = await callCheckInBackend(cleanToken, state.pin);
      const safeResult = result && typeof result === 'object'
        ? result
        : { ok: false, code: 'SYSTEM_ERROR', message: 'Unexpected server response' };

      renderResult(safeResult);
      addRecentScan(safeResult, source);

      if (safeResult.code === 'AUTH_FAILED') {
        ui['staff-pin'].focus();
      }
    } catch (error) {
      console.error('TFB check-in verification failed:', error);
      renderResult({
        code: 'SYSTEM_ERROR',
        message: 'Could not verify ticket',
        detail: error.message || 'Check the connection and Apps Script deployment.'
      });
    } finally {
      state.processing = false;
      setButtonBusy(ui['verify-manual-ticket'], false, 'Verifying…', 'Verify ticket');
    }
  }

  function addRecentScan(result, source) {
    const record = {
      time: new Date(),
      ticketId: result.ticketId || '—',
      name: result.name || 'Unknown attendee',
      code: result.code || 'SYSTEM_ERROR',
      source
    };

    state.recentScans.unshift(record);
    state.recentScans = state.recentScans.slice(0, state.scanLimit);
    renderRecentScans();
  }

  function renderRecentScans() {
    ui['recent-scans-body'].replaceChildren();
    ui['scan-count'].textContent = `${state.recentScans.length} recent scan${state.recentScans.length === 1 ? '' : 's'}`;

    if (!state.recentScans.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.className = 'empty-state';
      cell.textContent = 'No tickets scanned in this session yet.';
      row.appendChild(cell);
      ui['recent-scans-body'].appendChild(row);
      return;
    }

    state.recentScans.forEach((record) => {
      const row = document.createElement('tr');
      addCell(row, record.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      addCell(row, record.ticketId);
      addCell(row, record.name);

      const statusCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'scan-status ' + statusClass(record.code);
      badge.textContent = statusLabel(record.code);
      statusCell.appendChild(badge);
      row.appendChild(statusCell);
      ui['recent-scans-body'].appendChild(row);
    });
  }

  function addCell(row, text) {
    const cell = document.createElement('td');
    cell.textContent = String(text || '—');
    row.appendChild(cell);
  }

  function statusClass(code) {
    if (code === 'SUCCESS') return 'scan-status-success';
    if (code === 'ALREADY_USED') return 'scan-status-warning';
    return 'scan-status-error';
  }

  function statusLabel(code) {
    if (code === 'SUCCESS') return 'Accepted';
    if (code === 'ALREADY_USED') return 'Already checked in';
    if (code === 'INVALID') return 'Invalid';
    if (code === 'NOT_ISSUED') return 'Not issued';
    if (code === 'AUTH_FAILED') return 'Access denied';
    return 'Error';
  }

  async function startScanner() {
    if (!hasAppsScriptBridge()) {
      setSystemStatus('Backend not connected', false);
      renderResult({
        code: 'SYSTEM_ERROR',
        message: 'This page is not connected to Google Sheets',
        detail: 'The current HTML is in GitHub. Serve the UI through Apps Script HTML Service to use its secure google.script.run connection, or build a separate authenticated backend API.'
      });
      return;
    }

    if (typeof window.Html5Qrcode !== 'function') {
      renderResult({
        code: 'SYSTEM_ERROR',
        message: 'QR scanner library did not load',
        detail: 'Check the internet connection and confirm the html5-qrcode script is loaded before script.js.'
      });
      return;
    }

    const pin = ui['staff-pin'].value.trim();
    if (pin.length < 16) {
      renderResult({
        code: 'AUTH_FAILED',
        message: 'Enter the staff access code',
        detail: 'Use the private access code configured by the event administrator.'
      });
      ui['staff-pin'].focus();
      return;
    }

    if (state.cameraActive) return;

    try {
      if (state.scanner) {
        try { await state.scanner.clear(); } catch (_) { /* already cleared */ }
        state.scanner = null;
      }

      state.scanner = new window.Html5Qrcode('qr-reader');
      ui['scanner-caption'].textContent = 'Requesting camera access…';
      setButtonBusy(ui['start-scanner'], true, 'Starting…', 'Start camera');

      await state.scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 },
        (decodedText) => handleDecodedQr(decodedText),
        () => { /* A frame without a QR is normal; do not spam the UI. */ }
      );

      state.cameraActive = true;
      setSystemStatus('Scanner ready', true);
      ui['scanner-caption'].textContent = 'Camera active. Hold the attendee QR steady inside the scan area.';
      ui['start-scanner'].disabled = true;
      ui['stop-scanner'].disabled = false;
      ui['start-scanner'].textContent = 'Camera active';
      renderResult({
        code: 'READY',
        message: 'Camera active — ready to scan',
        detail: 'Scan one attendee ticket at a time. Wait for the validation result before scanning the next ticket.'
      });
    } catch (error) {
      console.error('Could not start QR scanner:', error);
      state.cameraActive = false;
      setSystemStatus('Camera unavailable', false);
      ui['scanner-caption'].textContent = 'Camera could not start. Allow camera access and open the site over HTTPS.';
      renderResult({
        code: 'SYSTEM_ERROR',
        message: 'Cannot start camera',
        detail: 'Allow camera permission, use HTTPS, and close other apps that may be using the camera.'
      });
    } finally {
      if (!state.cameraActive) {
        setButtonBusy(ui['start-scanner'], false, 'Starting…', 'Start camera');
      }
    }
  }

  function handleDecodedQr(decodedText) {
    if (state.processing) return;
    if (state.scanner && state.cameraActive) {
      try { state.scanner.pause(true); } catch (_) { /* scanner may already be paused */ }
    }

    Promise.resolve(verifyTicket(decodedText, 'camera')).finally(() => {
      window.setTimeout(() => {
        if (state.scanner && state.cameraActive && !state.processing) {
          try { state.scanner.resume(); } catch (_) { /* scanner may have stopped */ }
        }
      }, 1600);
    });
  }

  async function stopScanner() {
    const scanner = state.scanner;
    state.scanner = null;
    state.cameraActive = false;

    try {
      if (scanner) {
        try { await scanner.stop(); } catch (_) { /* it may already be stopped */ }
        try { await scanner.clear(); } catch (_) { /* no camera UI left to clear */ }
      }
    } finally {
      ui['start-scanner'].disabled = false;
      ui['start-scanner'].textContent = 'Start camera';
      ui['stop-scanner'].disabled = true;
      ui['scanner-caption'].textContent = 'Camera stopped. Start the camera when the next attendee is ready.';
      setSystemStatus(hasAppsScriptBridge() ? 'Backend connected' : 'Backend not connected', hasAppsScriptBridge());
    }
  }

  function togglePinVisibility() {
    const currentlyHidden = ui['staff-pin'].type === 'password';
    ui['staff-pin'].type = currentlyHidden ? 'text' : 'password';
    ui['toggle-pin'].textContent = currentlyHidden ? 'Hide' : 'Show';
    ui['toggle-pin'].setAttribute('aria-label', currentlyHidden ? 'Hide staff access code' : 'Show staff access code');
    ui['toggle-pin'].setAttribute('aria-pressed', String(currentlyHidden));
  }

  function handleManualSubmit(event) {
    event.preventDefault();
    if (state.processing) return;
    const token = ui['manual-token'].value.trim();
    if (!token) {
      renderResult({
        code: 'INVALID',
        message: 'Enter a ticket token',
        detail: 'Paste the raw token encoded in the QR code, not the ticket display ID.'
      });
      return;
    }
    verifyTicket(token, 'manual');
  }

  function onPinChanged() {
    if (state.pin && state.pin !== ui['staff-pin'].value.trim()) {
      state.pin = '';
    }
  }

  function initialise() {
    bindElements();
    renderRecentScans();
    renderResult({ code: 'READY' });
    setSystemStatus(
      hasAppsScriptBridge() ? 'Backend connected' : 'Backend not connected',
      hasAppsScriptBridge()
    );

    ui['start-scanner'].addEventListener('click', startScanner);
    ui['stop-scanner'].addEventListener('click', stopScanner);
    ui['toggle-pin'].addEventListener('click', togglePinVisibility);
    ui['manual-ticket-form'].addEventListener('submit', handleManualSubmit);
    ui['staff-pin'].addEventListener('input', onPinChanged);

    if (!hasAppsScriptBridge()) {
      ui['scanner-caption'].textContent = 'The GitHub-hosted page has no direct Apps Script connection. Deploy this interface through Apps Script HTML Service or connect a separately authenticated API before using check-in.';
    }
  }

  document.addEventListener('DOMContentLoaded', initialise, { once: true });
})();

