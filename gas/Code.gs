const LICENSE_SHEET = 'licenses';
const LOG_SHEET = 'logs';
const AUDIT_LOG_SHEET = 'audit_logs';
const FEEDBACK_SHEET = 'feedback';

const LICENSE_HEADERS = [
  'id',
  'clinic_id',
  'clinic_name',
  'license_key',
  'status',
  'expired_at',
  'created_at',
  'last_checked_at',
  'device_id',
];

const LOG_HEADERS = ['id', 'clinic_id', 'action', 'timestamp', 'ip'];
const ALLOWED_STATUSES = ['active', 'suspended', 'blocked', 'expired'];
const FEEDBACK_STATUSES = ['new', 'reviewing', 'resolved', 'ignored'];

const AUDIT_LOG_HEADERS = [
  'id',
  'timestamp',
  'action',
  'license_key',
  'clinic_name',
  'device_id',
  'status',
  'message',
  'old_status',
  'new_status',
  'old_expired_at',
  'new_expired_at',
  'old_device_id',
  'new_device_id',
  'app_name',
  'app_version',
  'os_name',
];

const FEEDBACK_HEADERS = [
  'id',
  'timestamp',
  'status',
  'severity',
  'clinic_id',
  'clinic_name',
  'license_key',
  'device_id',
  'app_name',
  'app_version',
  'os_name',
  'error_type',
  'message',
  'source',
  'stack',
  'context',
  'resolved_at',
  'note',
];

function doPost(e) {
  let body = {};
  let action = '';

  try {
    body = parseBody_(e);
    action = required_(body.action, 'action');
    body.action = action;

    setupSheets();

    validateSecret_(body);

    const handlers = {
      verify_license: verifyLicense_,
      register_clinic: registerClinic_,
      update_license: updateLicense_,
      reset_device: resetDevice_,
      list_licenses: listLicenses_,
      list_logs: listLogs_,
      report_feedback: reportFeedback_,
      list_feedback: listFeedback_,
      update_feedback_status: updateFeedbackStatus_,
    };

    if (!handlers[action]) {
      throw new Error('Action tidak dikenal: ' + action);
    }

    const result = handlers[action](body, e);
    const payload = {
      success: true,
      message: result.message || 'Request berhasil.',
      data: result.data || {},
    };

    appendAuditLog_(body, action, getAuditStatus_(action, payload), payload.message, payload.data);
    return json_(payload);
  } catch (error) {
    const message = error.message || String(error);
    try {
      setupSheets();
      appendAuditLog_(body, action || body.action || '', 'failed', message, {});
    } catch (auditError) {
      // Jangan gagalkan response utama hanya karena audit log gagal ditulis.
    }

    return json_({
      success: false,
      message,
      data: {},
    });
  }
}

function doGet() {
  return json_({
    success: true,
    message: 'Gunakan POST JSON dengan field action.',
    data: {
      service: 'Bekam License Management API',
    },
  });
}

function setupSheets() {
  const spreadsheet = getSpreadsheet_();
  ensureSheet_(spreadsheet, LICENSE_SHEET, LICENSE_HEADERS);
  ensureSheet_(spreadsheet, LOG_SHEET, LOG_HEADERS);
  ensureSheet_(spreadsheet, AUDIT_LOG_SHEET, AUDIT_LOG_HEADERS);
  ensureSheet_(spreadsheet, FEEDBACK_SHEET, FEEDBACK_HEADERS);
}

function verifyLicense_(body, e) {
  const licenseKey = required_(body.license_key, 'license_key');
  const clinicId = required_(body.clinic_id, 'clinic_id');
  const deviceId = optionalString_(body.device_id);
  const serverTime = nowIso_();
  const sheet = getSpreadsheet_().getSheetByName(LICENSE_SHEET);
  const table = getTable_(sheet);
  const rowIndex = table.rows.findIndex((row) => row.license_key === licenseKey && row.clinic_id === clinicId);

  if (rowIndex === -1) {
    appendLog_(clinicId, 'verify_failed', e, body.ip);
    return {
      message: 'License key tidak ditemukan.',
      data: {
        valid: false,
        reason: 'not_found',
        status: 'not_found',
        clinic_name: '',
        expired_at: '',
        license_key: licenseKey,
        clinic_id: clinicId,
        device_id: deviceId,
        server_time: serverTime,
      },
    };
  }

  const license = table.rows[rowIndex];
  const sheetRow = rowIndex + 2;
  const expired = isExpired_(license.expired_at);
  const storedDeviceId = license.device_id || '';
  let valid = true;
  let reason = 'valid';
  let message = 'License valid.';

  if (license.status !== 'active') {
    valid = false;
    reason = 'status_not_active';
    message = 'License tidak aktif.';
  } else if (expired) {
    valid = false;
    reason = 'expired';
    message = 'License sudah expired.';
  } else if (deviceId && storedDeviceId && storedDeviceId !== deviceId) {
    valid = false;
    reason = 'device_mismatch';
    message = 'License terdaftar untuk device lain.';
  }

  if (deviceId && !storedDeviceId && valid && table.headerMap.device_id !== undefined) {
    sheet.getRange(sheetRow, table.headerMap.device_id + 1).setValue(deviceId);
  }

  sheet.getRange(sheetRow, table.headerMap.last_checked_at + 1).setValue(serverTime);
  appendLog_(clinicId, valid ? 'verify_valid' : 'verify_invalid_' + reason, e, body.ip);

  return {
    message,
    data: {
      valid,
      reason,
      status: expired ? 'expired' : license.status,
      clinic_name: license.clinic_name || '',
      expired_at: license.expired_at || '',
      clinic_id: license.clinic_id || '',
      license_key: license.license_key || '',
      device_id: deviceId || storedDeviceId || '',
      server_time: serverTime,
    },
  };
}

function registerClinic_(body, e) {
  const clinicName = required_(body.clinic_name, 'clinic_name');
  const clinicId = 'CLN-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  const licenseKey = generateLicenseKey_();
  const createdAt = nowIso_();
  const expiredAt = body.expired_at !== undefined ? validateExpiredAt_(body.expired_at) : addDaysIso_(3);
  const sheet = getSpreadsheet_().getSheetByName(LICENSE_SHEET);

  sheet.appendRow([
    Utilities.getUuid(),
    clinicId,
    clinicName,
    licenseKey,
    'active',
    expiredAt,
    createdAt,
    '',
    '',
  ]);

  appendLog_(clinicId, 'register_clinic', e, body.ip);

  return {
    message: 'Klinik berhasil didaftarkan.',
    data: {
      clinic_id: clinicId,
      license_key: licenseKey,
      status: 'active',
      expired_at: expiredAt,
    },
  };
}

function updateLicense_(body, e) {
  const licenseKey = required_(body.license_key, 'license_key');
  const status = validateStatus_(body.status);
  const expiredAt = validateExpiredAt_(body.expired_at);
  const deviceId = body.device_id !== undefined ? optionalString_(body.device_id) : '';

  const sheet = getSpreadsheet_().getSheetByName(LICENSE_SHEET);
  const table = getTable_(sheet);
  const rowIndex = table.rows.findIndex((row) => row.license_key === licenseKey);

  if (rowIndex === -1) {
    throw new Error('License key tidak ditemukan.');
  }

  const sheetRow = rowIndex + 2;
  const oldLicense = table.rows[rowIndex];
  const oldStatus = oldLicense.status || '';
  const oldExpiredAt = oldLicense.expired_at || '';
  const oldDeviceId = oldLicense.device_id || '';
  const newDeviceId = body.device_id !== undefined ? deviceId : oldDeviceId;

  sheet.getRange(sheetRow, table.headerMap.status + 1).setValue(status);
  sheet.getRange(sheetRow, table.headerMap.expired_at + 1).setValue(expiredAt);
  if (body.device_id !== undefined && table.headerMap.device_id !== undefined) {
    sheet.getRange(sheetRow, table.headerMap.device_id + 1).setValue(newDeviceId);
  }

  appendLog_(oldLicense.clinic_id, 'update_license', e, body.ip);

  return {
    message: 'License berhasil diperbarui.',
    data: {
      license_key: licenseKey,
      clinic_name: oldLicense.clinic_name || '',
      device_id: newDeviceId,
      status,
      expired_at: expiredAt,
      audit: {
        old_status: oldStatus,
        new_status: status,
        old_expired_at: oldExpiredAt,
        new_expired_at: expiredAt,
        old_device_id: oldDeviceId,
        new_device_id: newDeviceId,
      },
    },
  };
}

function resetDevice_(body, e) {
  const licenseKey = required_(body.license_key, 'license_key');
  const sheet = getSpreadsheet_().getSheetByName(LICENSE_SHEET);
  const table = getTable_(sheet);
  const rowIndex = table.rows.findIndex((row) => row.license_key === licenseKey);

  if (rowIndex === -1) {
    throw new Error('License key tidak ditemukan.');
  }

  if (table.headerMap.device_id === undefined) {
    throw new Error('Kolom device_id belum tersedia.');
  }

  const sheetRow = rowIndex + 2;
  const license = table.rows[rowIndex];
  const oldDeviceId = license.device_id || '';

  sheet.getRange(sheetRow, table.headerMap.device_id + 1).setValue('');
  appendLog_(license.clinic_id, 'reset_device', e, body.ip);

  return {
    message: 'Device license berhasil direset.',
    data: {
      license_key: licenseKey,
      clinic_name: license.clinic_name || '',
      device_id: '',
      audit: {
        old_device_id: oldDeviceId,
        new_device_id: '',
      },
    },
  };
}

function listLicenses_() {
  const sheet = getSpreadsheet_().getSheetByName(LICENSE_SHEET);
  const table = getTable_(sheet);
  const licenses = table.rows.map((row) => ({
    ...row,
    status: getEffectiveStatus_(row.status, row.expired_at),
  }));

  return {
    message: 'Data license berhasil diambil.',
    data: { licenses },
  };
}

function listLogs_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(LOG_SHEET);
  const table = getTable_(sheet);
  const licenseTable = getTable_(spreadsheet.getSheetByName(LICENSE_SHEET));
  const licenseByClinic = licenseTable.rows.reduce((acc, row) => {
    acc[row.clinic_id] = row;
    return acc;
  }, {});
  const logs = table.rows
    .map((row) => {
      const license = licenseByClinic[row.clinic_id] || {};
      return {
        ...row,
        clinic_name: license.clinic_name || '',
        license_key: license.license_key || '',
        status: license.status || '',
      };
    })
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));

  return {
    message: 'Log berhasil diambil.',
    data: { logs: logs.slice(0, 100) },
  };
}

function reportFeedback_(body, e) {
  const message = required_(body.message, 'message');
  const timestamp = nowIso_();
  const license = findLicenseForAudit_(body, body);
  const sheet = getSpreadsheet_().getSheetByName(FEEDBACK_SHEET);

  sheet.appendRow([
    Utilities.getUuid(),
    timestamp,
    'new',
    sanitizeFeedbackSeverity_(body.severity),
    optionalString_(body.clinic_id) || license.clinic_id || '',
    optionalString_(body.clinic_name) || license.clinic_name || '',
    optionalString_(body.license_key) || license.license_key || '',
    optionalString_(body.device_id) || license.device_id || '',
    optionalString_(body.app_name),
    optionalString_(body.app_version),
    optionalString_(body.os_name),
    truncate_(optionalString_(body.error_type), 180),
    truncate_(message, 1200),
    truncate_(optionalString_(body.source), 260),
    truncate_(optionalString_(body.stack), 6000),
    truncate_(optionalString_(body.context), 2000),
    '',
    '',
  ]);

  appendLog_(optionalString_(body.clinic_id) || license.clinic_id || '', 'report_feedback', e, body.ip);

  return {
    message: 'Feedback error berhasil dikirim.',
    data: { status: 'new', timestamp },
  };
}

function listFeedback_() {
  const sheet = getSpreadsheet_().getSheetByName(FEEDBACK_SHEET);
  const table = getTable_(sheet);
  const feedback = table.rows
    .map((row) => ({
      ...row,
      status: FEEDBACK_STATUSES.indexOf(row.status) === -1 ? 'new' : row.status,
    }))
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));

  return {
    message: 'Feedback berhasil diambil.',
    data: { feedback },
  };
}

function updateFeedbackStatus_(body) {
  const id = required_(body.id, 'id');
  const status = validateFeedbackStatus_(body.status);
  const note = optionalString_(body.note);
  const sheet = getSpreadsheet_().getSheetByName(FEEDBACK_SHEET);
  const table = getTable_(sheet);
  const rowIndex = table.rows.findIndex((row) => row.id === id);

  if (rowIndex === -1) {
    throw new Error('Feedback tidak ditemukan.');
  }

  const sheetRow = rowIndex + 2;
  sheet.getRange(sheetRow, table.headerMap.status + 1).setValue(status);
  if (table.headerMap.note !== undefined) {
    sheet.getRange(sheetRow, table.headerMap.note + 1).setValue(note);
  }
  if (table.headerMap.resolved_at !== undefined) {
    sheet.getRange(sheetRow, table.headerMap.resolved_at + 1).setValue(status === 'resolved' ? nowIso_() : '');
  }

  return {
    message: 'Status feedback diperbarui.',
    data: { id, status, note },
  };
}

function parseBody_(e) {
  if (e && e.postData && e.postData.contents) {
    return JSON.parse(e.postData.contents);
  }

  if (e && e.parameter && Object.keys(e.parameter).length) {
    return e.parameter;
  }

  return {};
}

function getSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }

  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }

  const headerColumnCount = Math.max(headers.length, sheet.getLastColumn() || headers.length);
  const currentHeaders = sheet.getRange(1, 1, 1, headerColumnCount).getValues()[0];
  const needsHeaders = currentHeaders.every((value) => value === '');

  if (needsHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    const missingHeaders = headers.filter((header) => currentHeaders.indexOf(header) === -1);
    if (missingHeaders.length) {
      const lastHeaderColumn = currentHeaders.reduce((lastColumn, header, index) => {
        return header === '' ? lastColumn : index + 1;
      }, 0);
      sheet.getRange(1, lastHeaderColumn + 1, 1, missingHeaders.length).setValues([missingHeaders]);
    }
  }

  return sheet;
}

function validateSecret_(body) {
  const expectedSecret = PropertiesService.getScriptProperties().getProperty('API_SECRET');
  if (!expectedSecret) {
    throw new Error('API_SECRET belum diset di Script Properties.');
  }

  if (!body.secret_key || sanitizeString_(body.secret_key) !== expectedSecret) {
    throw new Error('Secret key tidak valid.');
  }
}

function getTable_(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0] || [];
  const headerMap = headers.reduce((acc, header, index) => {
    acc[header] = index;
    return acc;
  }, {});

  const rows = values.slice(1).filter((row) => row.some(Boolean)).map((row) => {
    return headers.reduce((acc, header, index) => {
      acc[header] = row[index] || '';
      return acc;
    }, {});
  });

  return { headers, headerMap, rows };
}

function appendLog_(clinicId, action, e, ip) {
  const sheet = getSpreadsheet_().getSheetByName(LOG_SHEET);
  sheet.appendRow([
    Utilities.getUuid(),
    clinicId || '',
    action,
    nowIso_(),
    sanitizeIp_(ip) || getIp_(e),
  ]);
}

function appendAuditLog_(body, action, status, message, data) {
  const sheet = getSpreadsheet_().getSheetByName(AUDIT_LOG_SHEET);
  const payload = data || {};
  const audit = payload.audit || {};
  const license = findLicenseForAudit_(body, payload);
  const licenseKey = payload.license_key || body.license_key || license.license_key || '';
  const clinicName = payload.clinic_name || body.clinic_name || license.clinic_name || '';
  const deviceId = payload.device_id || body.device_id || license.device_id || audit.old_device_id || '';
  const appName = payload.app_name || body.app_name || '';
  const appVersion = payload.app_version || body.app_version || '';
  const osName = payload.os_name || body.os_name || '';

  sheet.appendRow([
    Utilities.getUuid(),
    nowIso_(),
    action || '',
    licenseKey,
    clinicName,
    deviceId,
    status,
    message || '',
    audit.old_status || '',
    audit.new_status || '',
    audit.old_expired_at || '',
    audit.new_expired_at || '',
    audit.old_device_id || '',
    audit.new_device_id || '',
    appName,
    appVersion,
    osName,
  ]);
}

function getAuditStatus_(action, payload) {
  if (action === 'verify_license') {
    return payload.data && payload.data.valid ? 'success' : 'failed';
  }

  return payload.success ? 'success' : 'failed';
}

function findLicenseForAudit_(body, data) {
  const licenseKey = (data && data.license_key) || (body && body.license_key) || '';
  if (!licenseKey) return {};

  try {
    const sheet = getSpreadsheet_().getSheetByName(LICENSE_SHEET);
    if (!sheet) return {};

    const table = getTable_(sheet);
    return table.rows.find((row) => row.license_key === licenseKey) || {};
  } catch (error) {
    return {};
  }
}

function getIp_(e) {
  if (!e || !e.parameter) return '';
  return sanitizeIp_(e.parameter.ip);
}

function sanitizeIp_(value) {
  const rawIp = optionalString_(value);
  if (!rawIp) return '';
  return rawIp.split(',')[0].trim().slice(0, 80);
}

function generateLicenseKey_() {
  const raw = Utilities.getUuid().replace(/-/g, '').toUpperCase().slice(0, 20);
  return 'BKM-' + raw.match(/.{1,4}/g).join('-');
}

function getEffectiveStatus_(status, expiredAt) {
  if (status === 'blocked' || status === 'suspended') return status;
  if (!expiredAt) return status || 'expired';

  if (isExpired_(expiredAt)) {
    return 'expired';
  }

  return status || 'expired';
}

function isExpired_(expiredAt) {
  if (!expiredAt) return false;
  const expiredDate = new Date(expiredAt);
  return !isNaN(expiredDate.getTime()) && expiredDate.getTime() < startOfToday_().getTime();
}

function required_(value, field) {
  const sanitized = sanitizeString_(value);
  if (sanitized === '') {
    throw new Error('Field ' + field + ' wajib diisi.');
  }

  return sanitized;
}

function optionalString_(value) {
  return sanitizeString_(value);
}

function sanitizeString_(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

function validateStatus_(value) {
  const status = required_(value, 'status').toLowerCase();
  if (ALLOWED_STATUSES.indexOf(status) === -1) {
    throw new Error('Status tidak valid. Gunakan active, suspended, blocked, atau expired.');
  }

  return status;
}

function validateFeedbackStatus_(value) {
  const status = required_(value, 'status').toLowerCase();
  if (FEEDBACK_STATUSES.indexOf(status) === -1) {
    throw new Error('Status feedback tidak valid.');
  }

  return status;
}

function sanitizeFeedbackSeverity_(value) {
  const severity = optionalString_(value).toLowerCase();
  if (['info', 'warning', 'error', 'critical'].indexOf(severity) === -1) {
    return 'error';
  }

  return severity;
}

function truncate_(value, maxLength) {
  const text = optionalString_(value);
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function validateExpiredAt_(value) {
  const expiredAt = optionalString_(value);
  if (!expiredAt) return '';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiredAt)) {
    throw new Error('expired_at harus format YYYY-MM-DD.');
  }

  const parts = expiredAt.split('-');
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(date.getTime())) {
    throw new Error('expired_at tidak valid.');
  }

  if (
    date.getFullYear() !== Number(parts[0]) ||
    date.getMonth() !== Number(parts[1]) - 1 ||
    date.getDate() !== Number(parts[2])
  ) {
    throw new Error('expired_at tidak valid.');
  }

  return expiredAt;
}

function nowIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function addDaysIso_(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function startOfToday_() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
