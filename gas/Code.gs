const LICENSE_SHEET = 'licenses';
const LOG_SHEET = 'logs';
const AUDIT_LOG_SHEET = 'audit_logs';
const FEEDBACK_SHEET = 'feedback';
const ADMIN_PIN_RESET_SHEET = 'admin_pin_resets';

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
  'mismatch_count',
];

const LOG_HEADERS = ['id', 'clinic_id', 'action', 'timestamp', 'ip'];
const ALLOWED_STATUSES = ['active', 'suspended', 'blocked', 'revoked', 'expired'];
const FEEDBACK_STATUSES = ['new', 'reviewing', 'resolved', 'ignored'];
const VERIFY_CACHE_SECONDS = 600;
const VERIFY_WRITE_THROTTLE_HOURS = 6;
const ERROR_REPORT_RATE_LIMIT_SECONDS = 120;
const ADMIN_PIN_RESET_EXPIRE_MINUTES = 30;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;
const DASHBOARD_ERROR_LIMIT = 50;
const DASHBOARD_LOG_LIMIT = 50;
const INVALID_VERIFY_CACHE_SECONDS = 60;
const LOCK_WAIT_MS = 10000;

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
  'mismatch_count',
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

const ADMIN_PIN_RESET_HEADERS = [
  'id',
  'timestamp',
  'status',
  'clinic_id',
  'clinic_name',
  'license_key',
  'device_id',
  'admin_pin',
  'reset_pin',
  'reset_token',
  'expires_at',
  'confirmed_at',
  'ip',
  'app_name',
  'app_version',
  'os_name',
  'message',
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
      create_license: registerClinic_,
      update_license: updateLicense_,
      reset_device: resetDevice_,
      list_licenses: listLicenses_,
      list_logs: listLogs_,
      report_feedback: reportFeedback_,
      report_error: reportFeedback_,
      request_admin_pin_reset: requestAdminPinReset_,
      confirm_admin_pin_reset: confirmAdminPinReset_,
      list_admin_pin_reset_requests: listAdminPinResetRequests_,
      list_feedback: listFeedback_,
      list_error_reports: listFeedback_,
      update_feedback_status: updateFeedbackStatus_,
      dashboard_snapshot: dashboardSnapshot_,
      delete_license: deleteLicense_,
      revoke_license: deleteLicense_,
      block_license: deleteLicense_,
    };

    if (!handlers[action]) {
      throw new Error('Action tidak dikenal: ' + action);
    }

    const result = handlers[action](body, e);
    const payload = buildApiPayload_(result);

    if (shouldWriteAuditLog_(action, result, payload)) {
      appendAuditLog_(body, action, getAuditStatus_(action, payload), result.message || 'Request berhasil.', payload.data);
    }
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
      ok: false,
      error: message,
    });
  }
}

function doGet() {
  return json_({
    ok: true,
    data: {
      service: 'Bekam License Management API',
      message: 'Gunakan POST JSON dengan field action.',
    },
  });
}

function buildApiPayload_(result) {
  if (result && result.payload) {
    return result.payload;
  }

  return {
    ok: true,
    data: result && result.data !== undefined ? result.data : {},
    ...(result && result.meta ? { meta: result.meta } : {}),
  };
}

function setupSheets() {
  const spreadsheet = getSpreadsheet_();
  ensureSheet_(spreadsheet, LICENSE_SHEET, LICENSE_HEADERS);
  ensureSheet_(spreadsheet, LOG_SHEET, LOG_HEADERS);
  ensureSheet_(spreadsheet, AUDIT_LOG_SHEET, AUDIT_LOG_HEADERS);
  ensureSheet_(spreadsheet, FEEDBACK_SHEET, FEEDBACK_HEADERS);
  ensureSheet_(spreadsheet, ADMIN_PIN_RESET_SHEET, ADMIN_PIN_RESET_HEADERS);
}

function verifyLicense_(body, e) {
  const licenseKey = required_(body.license_key, 'license_key');
  const clinicId = required_(body.clinic_id, 'clinic_id');
  const deviceId = optionalString_(body.device_id);
  const serverTime = nowIso_();
  const cache = getCache_();
  const cacheKey = makeVerifyCacheKey_(clinicId, licenseKey, deviceId);
  const cached = getJsonCache_(cache, cacheKey);
  if (cached) {
    return {
      message: cached.message || 'Request berhasil.',
      data: cached.data || {},
      payload: cached.payload || makeVerifyPayload_(cached.data || {}, cached.message || ''),
      skip_audit: true,
    };
  }

  const sheet = getSpreadsheet_().getSheetByName(LICENSE_SHEET);
  const table = getTable_(sheet);
  const rowIndex = table.rows.findIndex((row) => row.license_key === licenseKey && row.clinic_id === clinicId);

  if (rowIndex === -1) {
    const result = {
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
    appendLog_(clinicId, 'verify_failed', e, body.ip);
    result.payload = makeVerifyPayload_(result.data, result.message);
    putVerifyCache_(cache, cacheKey, result);
    return result;
  }

  const license = table.rows[rowIndex];
  const storedDeviceId = license.device_id || '';
  const initialResult = buildVerifyResult_(license, clinicId, licenseKey, deviceId, serverTime);
  const needsDeviceBinding = Boolean(deviceId && initialResult.data.valid && !storedDeviceId && table.headerMap.device_id !== undefined);
  const needsMismatchHandling = Boolean(initialResult.data.reason === 'device_mismatch');

  if (needsDeviceBinding) {
    return withScriptLock_(() => {
      const lockedTable = getTable_(sheet);
      const lockedRowIndex = lockedTable.rows.findIndex((row) => row.license_key === licenseKey && row.clinic_id === clinicId);
      if (lockedRowIndex === -1) {
        const missingResult = {
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
        appendLog_(clinicId, 'verify_failed', e, body.ip);
        missingResult.payload = makeVerifyPayload_(missingResult.data, missingResult.message);
        putVerifyCache_(cache, cacheKey, missingResult);
        return missingResult;
      }

      const lockedLicense = lockedTable.rows[lockedRowIndex];
      const lockedResult = buildVerifyResult_(lockedLicense, clinicId, licenseKey, deviceId, serverTime);
      const lockedStoredDeviceId = lockedLicense.device_id || '';
      const bindsDevice = Boolean(deviceId && lockedResult.data.valid && !lockedStoredDeviceId && lockedTable.headerMap.device_id !== undefined);
      const shouldWriteActivity = shouldWriteVerifyActivity_(lockedLicense, lockedResult.data.valid, bindsDevice);

      if (bindsDevice) {
        sheet.getRange(lockedRowIndex + 2, lockedTable.headerMap.device_id + 1).setValue(deviceId);
        resetDeviceMismatchCount_(sheet, lockedTable, lockedRowIndex);
        lockedResult.data.device_id = deviceId;
      }

      if (shouldWriteActivity) {
        sheet.getRange(lockedRowIndex + 2, lockedTable.headerMap.last_checked_at + 1).setValue(serverTime);
        appendLog_(clinicId, lockedResult.data.valid ? 'verify_valid' : 'verify_invalid_' + lockedResult.data.reason, e, body.ip);
      }

      putVerifyCache_(cache, cacheKey, lockedResult);
      return {
        ...lockedResult,
        payload: makeVerifyPayload_(lockedResult.data, lockedResult.message),
        skip_audit: lockedResult.data.valid && !shouldWriteActivity,
      };
    });
  }

  if (needsMismatchHandling) {
    return withScriptLock_(() => {
      const lockedTable = getTable_(sheet);
      const lockedRowIndex = lockedTable.rows.findIndex((row) => row.license_key === licenseKey && row.clinic_id === clinicId);
      if (lockedRowIndex === -1) {
        const missingResult = {
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
        missingResult.payload = makeVerifyPayload_(missingResult.data, missingResult.message);
        putVerifyCache_(cache, cacheKey, missingResult);
        return missingResult;
      }

      const lockedLicense = lockedTable.rows[lockedRowIndex];
      const lockedStoredDeviceId = lockedLicense.device_id || '';
      if (!lockedStoredDeviceId || lockedStoredDeviceId === deviceId) {
        const raceResult = buildVerifyResult_(lockedLicense, clinicId, licenseKey, deviceId, serverTime);
        const bindsDevice = Boolean(deviceId && raceResult.data.valid && !lockedStoredDeviceId && lockedTable.headerMap.device_id !== undefined);
        const shouldWriteActivity = shouldWriteVerifyActivity_(lockedLicense, raceResult.data.valid, bindsDevice);
        if (bindsDevice) {
          sheet.getRange(lockedRowIndex + 2, lockedTable.headerMap.device_id + 1).setValue(deviceId);
          resetDeviceMismatchCount_(sheet, lockedTable, lockedRowIndex);
          raceResult.data.device_id = deviceId;
        }
        if (shouldWriteActivity) {
          sheet.getRange(lockedRowIndex + 2, lockedTable.headerMap.last_checked_at + 1).setValue(serverTime);
          appendLog_(clinicId, raceResult.data.valid ? 'verify_valid' : 'verify_invalid_' + raceResult.data.reason, e, body.ip);
        }
        raceResult.payload = makeVerifyPayload_(raceResult.data, raceResult.message);
        putVerifyCache_(cache, cacheKey, raceResult);
        return {
          ...raceResult,
          skip_audit: raceResult.data.valid && !shouldWriteActivity,
        };
      }

      const mismatchCount = incrementDeviceMismatch_(sheet, lockedTable, lockedRowIndex);
      const suspended = mismatchCount >= 3 && lockedLicense.status !== 'suspended';
      if (suspended && lockedTable.headerMap.status !== undefined) {
        sheet.getRange(lockedRowIndex + 2, lockedTable.headerMap.status + 1).setValue('suspended');
      }

      appendLog_(clinicId, 'device_mismatch', e, body.ip);
      appendAuditLog_(
        {
          ...body,
          device_id: deviceId,
        },
        'device_mismatch',
        'failed',
        suspended
          ? 'Device mismatch mencapai batas. Lisensi disuspend.'
          : 'Device mismatch terdeteksi.',
        {
          license_key: licenseKey,
          clinic_id: clinicId,
          clinic_name: lockedLicense.clinic_name || '',
          device_id: deviceId,
          audit: {
            old_status: lockedLicense.status || '',
            new_status: suspended ? 'suspended' : (lockedLicense.status || ''),
            old_device_id: lockedStoredDeviceId,
            new_device_id: deviceId,
            mismatch_count: mismatchCount,
          },
        },
      );
      clearLicenseCache_(clinicId, licenseKey);

      const mismatchResult = buildVerifyResult_(
        {
          ...lockedLicense,
          status: suspended ? 'suspended' : lockedLicense.status,
          mismatch_count: String(mismatchCount),
        },
        clinicId,
        licenseKey,
        deviceId,
        serverTime,
      );
      mismatchResult.message = suspended
        ? 'Lisensi disuspend karena device mismatch berulang.'
        : 'License terdaftar untuk device lain.';
      mismatchResult.data.reason = suspended ? 'suspended' : 'device_mismatch';
      mismatchResult.data.status = suspended ? 'suspended' : mismatchResult.data.status;
      mismatchResult.data.mismatch_count = mismatchCount;
      mismatchResult.payload = makeVerifyPayload_(mismatchResult.data, mismatchResult.message);
      return {
        ...mismatchResult,
        skip_audit: true,
      };
    });
  }

  const shouldWriteActivity = shouldWriteVerifyActivity_(license, initialResult.data.valid, false);
  if (shouldWriteActivity) {
    withScriptLock_(() => {
      const lockedTable = getTable_(sheet);
      const lockedRowIndex = lockedTable.rows.findIndex((row) => row.license_key === licenseKey && row.clinic_id === clinicId);
      if (lockedRowIndex !== -1) {
        sheet.getRange(lockedRowIndex + 2, lockedTable.headerMap.last_checked_at + 1).setValue(serverTime);
      }
      appendLog_(clinicId, initialResult.data.valid ? 'verify_valid' : 'verify_invalid_' + initialResult.data.reason, e, body.ip);
    });
  }

  putVerifyCache_(cache, cacheKey, initialResult);
  return {
    ...initialResult,
    payload: makeVerifyPayload_(initialResult.data, initialResult.message),
    skip_audit: initialResult.data.valid && !shouldWriteActivity,
  };
}

function registerClinic_(body, e) {
  return withScriptLock_(() => {
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
    clearLicenseCache_(clinicId, licenseKey);

    return {
      message: 'Klinik berhasil didaftarkan.',
      data: {
        clinic_id: clinicId,
        license_key: licenseKey,
        status: 'active',
        expired_at: expiredAt,
      },
    };
  });
}

function updateLicense_(body, e) {
  return withScriptLock_(() => {
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
    clearLicenseCache_(oldLicense.clinic_id, licenseKey);

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
  });
}

function resetDevice_(body, e) {
  return withScriptLock_(() => {
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
    resetDeviceMismatchCount_(sheet, table, rowIndex);
    appendLog_(license.clinic_id, 'reset_device', e, body.ip);
    clearLicenseCache_(license.clinic_id, licenseKey);

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
  });
}

function listLicenses_(body) {
  const sheet = getSpreadsheet_().getSheetByName(LICENSE_SHEET);
  const table = getTable_(sheet);
  const paging = normalizeLimitOffset_(body || {});
  const search = optionalString_((body || {}).search).toLowerCase();
  const statusFilter = optionalString_((body || {}).status).toLowerCase();
  const licenses = table.rows.map((row) => ({
    ...row,
    status: getEffectiveStatus_(row.status, row.expired_at),
  })).filter((row) => {
    if (statusFilter && row.status !== statusFilter) return false;
    if (!search) return true;
    return [
      row.clinic_id,
      row.clinic_name,
      row.license_key,
      row.device_id,
      row.status,
    ].some((value) => String(value || '').toLowerCase().indexOf(search) !== -1);
  });
  const page = paginatedRows_(licenses, paging.limit, paging.offset);

  return {
    message: 'Data license berhasil diambil.',
    data: { licenses: page.rows },
    meta: { ...paging, total: licenses.length },
    payload: {
      ok: true,
      data: page.rows,
      meta: { ...paging, total: licenses.length },
    },
  };
}

function listLogs_(body) {
  const paging = normalizeLimitOffset_(body || {});
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
  const page = paginatedRows_(logs, paging.limit, paging.offset);

  return {
    message: 'Log berhasil diambil.',
    data: { logs: page.rows },
    meta: { ...paging, total: logs.length },
    payload: {
      ok: true,
      data: page.rows,
      meta: { ...paging, total: logs.length },
    },
  };
}

function reportFeedback_(body, e) {
  const message = truncate_(required_(body.error_message || body.message, 'error_message'), 1200);
  const timestamp = nowIso_();
  const clinicId = optionalString_(body.clinic_id);
  const licenseKey = optionalString_(body.license_key);
  const deviceId = optionalString_(body.device_id);
  const appVersion = truncate_(optionalString_(body.app_version), 80);
  const errorType = truncate_(optionalString_(body.error_type || body.error_kind), 180);
  const source = truncate_(optionalString_(body.source || body.module || body.page), 260);
  const stack = truncate_(optionalString_(body.stack || body.stack_trace), 6000);
  const context = truncate_(optionalString_(body.context), 2000);
  const rateLimitKey = makeErrorRateLimitKey_(clinicId, deviceId, message);
  const cache = getCache_();

  if (cache.get(rateLimitKey)) {
    return {
      message: 'Laporan error terlalu sering dikirim.',
      payload: {
        ok: true,
        message: 'Laporan error sudah diterima sebelumnya.',
        throttled: true,
      },
      skip_audit: true,
    };
  }

  const license = findLicenseForAudit_(body, body);
  const sheet = getSpreadsheet_().getSheetByName(FEEDBACK_SHEET);

  sheet.appendRow([
    Utilities.getUuid(),
    timestamp,
    'new',
    sanitizeFeedbackSeverity_(body.severity),
    clinicId || license.clinic_id || '',
    optionalString_(body.clinic_name) || license.clinic_name || '',
    licenseKey || license.license_key || '',
    deviceId || license.device_id || '',
    optionalString_(body.app_name),
    appVersion,
    optionalString_(body.os_name),
    errorType,
    message,
    source,
    stack,
    context,
    '',
    '',
  ]);

  cache.put(rateLimitKey, '1', ERROR_REPORT_RATE_LIMIT_SECONDS);
  appendLog_(clinicId || license.clinic_id || '', 'report_feedback', e, body.ip);

  return {
    message: 'Laporan error berhasil dikirim',
    data: { status: 'new', timestamp },
    payload: {
      ok: true,
      message: 'Laporan error berhasil dikirim',
      data: { status: 'new', timestamp },
    },
  };
}

function listFeedback_(body) {
  const paging = normalizeLimitOffset_(body || {});
  const sheet = getSpreadsheet_().getSheetByName(FEEDBACK_SHEET);
  const table = getTable_(sheet);
  const feedback = table.rows
    .map((row) => ({
      ...row,
      status: FEEDBACK_STATUSES.indexOf(row.status) === -1 ? 'new' : row.status,
    }))
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  const page = paginatedRows_(feedback, paging.limit, paging.offset);

  return {
    message: 'Feedback berhasil diambil.',
    data: { feedback: page.rows },
    meta: { ...paging, total: feedback.length },
    payload: {
      ok: true,
      data: page.rows,
      meta: { ...paging, total: feedback.length },
    },
  };
}

function requestAdminPinReset_(body, e) {
  return withScriptLock_(() => {
    const licenseKey = required_(body.license_key, 'license_key');
    const clinicId = optionalString_(body.clinic_id);
    const deviceId = optionalString_(body.device_id);
    const adminPin = truncate_(optionalString_(body.admin_pin), 120);
    const timestamp = nowIso_();
    const expiresAt = addMinutesIso_(ADMIN_PIN_RESET_EXPIRE_MINUTES);
    const resetToken = generateResetToken_();
    const resetPin = generateResetPin_();
    const license = findLicenseForPinReset_(clinicId, licenseKey);

    if (!license) {
      throw new Error('License key tidak ditemukan.');
    }

    if (clinicId && license.clinic_id !== clinicId) {
      throw new Error('Clinic ID tidak sesuai dengan license key.');
    }

    const sheet = getSpreadsheet_().getSheetByName(ADMIN_PIN_RESET_SHEET);
    const id = Utilities.getUuid();
    sheet.appendRow([
      id,
      timestamp,
      'pending',
      license.clinic_id || clinicId,
      license.clinic_name || '',
      license.license_key || licenseKey,
      deviceId,
      adminPin,
      resetPin,
      resetToken,
      expiresAt,
      '',
      sanitizeIp_(body.ip) || getIp_(e),
      truncate_(optionalString_(body.app_name), 120),
      truncate_(optionalString_(body.app_version), 80),
      truncate_(optionalString_(body.os_name), 120),
      truncate_(optionalString_(body.message), 500),
      '',
    ]);

    appendLog_(license.clinic_id || clinicId, 'request_admin_pin_reset', e, body.ip);

    return {
      message: 'Request reset PIN admin berhasil dibuat.',
      data: {
        id,
        status: 'pending',
        reset_token: resetToken,
        expires_at: expiresAt,
      },
      payload: {
        ok: true,
        message: 'Request reset PIN admin berhasil dibuat.',
        data: {
          id,
          status: 'pending',
          reset_token: resetToken,
          expires_at: expiresAt,
        },
      },
    };
  });
}

function confirmAdminPinReset_(body, e) {
  return withScriptLock_(() => {
    const resetToken = required_(body.reset_token || body.token, 'reset_token');
    const resetPin = required_(body.reset_pin || body.reset_code || body.code, 'reset_pin');
    const sheet = getSpreadsheet_().getSheetByName(ADMIN_PIN_RESET_SHEET);
    const table = getTable_(sheet);
    const rowIndex = table.rows.findIndex((row) => row.reset_token === resetToken);

    if (rowIndex === -1) {
      throw new Error('Token reset PIN tidak ditemukan.');
    }

    const request = table.rows[rowIndex];
    if (request.status === 'confirmed') {
      throw new Error('Token reset PIN sudah digunakan.');
    }

    if (request.status === 'expired' || isDateTimeExpired_(request.expires_at)) {
      updatePinResetStatus_(sheet, table, rowIndex, 'expired', '', 'Token reset PIN expired.');
      throw new Error('Token reset PIN expired.');
    }

    if (request.reset_pin !== resetPin) {
      throw new Error('Kode reset PIN tidak valid.');
    }

    updatePinResetStatus_(sheet, table, rowIndex, 'confirmed', nowIso_(), optionalString_(body.note));
    appendLog_(request.clinic_id, 'confirm_admin_pin_reset', e, body.ip);

    const data = {
      id: request.id,
      status: 'confirmed',
      reset_allowed: true,
      clinic_id: request.clinic_id || '',
      license_key: request.license_key || '',
      confirmed_at: nowIso_(),
    };

    return {
      message: 'Reset PIN admin terkonfirmasi.',
      data,
      payload: {
        ok: true,
        message: 'Reset PIN admin terkonfirmasi.',
        data,
      },
    };
  });
}

function listAdminPinResetRequests_(body) {
  const paging = normalizeLimitOffset_(body || {});
  const statusFilter = optionalString_((body || {}).status).toLowerCase();
  const search = optionalString_((body || {}).search).toLowerCase();
  const sheet = getSpreadsheet_().getSheetByName(ADMIN_PIN_RESET_SHEET);
  const table = getTable_(sheet);
  const requests = table.rows.map((row) => ({
    ...row,
    status: row.status === 'pending' && isDateTimeExpired_(row.expires_at) ? 'expired' : row.status,
  })).filter((row) => {
    if (statusFilter && row.status !== statusFilter) return false;
    if (!search) return true;
    return [
      row.clinic_id,
      row.clinic_name,
      row.license_key,
      row.device_id,
      row.status,
    ].some((value) => String(value || '').toLowerCase().indexOf(search) !== -1);
  }).sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  const page = paginatedRows_(requests, paging.limit, paging.offset);

  return {
    message: 'Request reset PIN admin berhasil diambil.',
    data: { requests: page.rows },
    meta: { ...paging, total: requests.length },
    payload: {
      ok: true,
      data: page.rows,
      meta: { ...paging, total: requests.length },
    },
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

function deleteLicense_(body, e) {
  return withScriptLock_(() => {
    const licenseKey = required_(body.license_key, 'license_key');
    const sheet = getSpreadsheet_().getSheetByName(LICENSE_SHEET);
    const table = getTable_(sheet);
    const rowIndex = table.rows.findIndex((row) => row.license_key === licenseKey);

    if (rowIndex === -1) {
      throw new Error('License key tidak ditemukan.');
    }

    const sheetRow = rowIndex + 2;
    const license = table.rows[rowIndex];
    const oldStatus = license.status || '';
    sheet.getRange(sheetRow, table.headerMap.status + 1).setValue('blocked');
    appendLog_(license.clinic_id, 'delete_license', e, body.ip);
    clearLicenseCache_(license.clinic_id, licenseKey);

    return {
      message: 'License berhasil dinonaktifkan.',
      data: {
        license_key: licenseKey,
        clinic_name: license.clinic_name || '',
        status: 'blocked',
        audit: {
          old_status: oldStatus,
          new_status: 'blocked',
        },
      },
    };
  });
}

function dashboardSnapshot_() {
  const spreadsheet = getSpreadsheet_();
  const licenseTable = getTable_(spreadsheet.getSheetByName(LICENSE_SHEET));
  const licenses = licenseTable.rows.map((row) => ({
    ...row,
    status: getEffectiveStatus_(row.status, row.expired_at),
  }));
  const summary = licenses.reduce((acc, row) => {
    acc.total += 1;
    if (row.status === 'active') acc.active += 1;
    if (row.status === 'expired') acc.expired += 1;
    if (row.status === 'blocked' || row.status === 'revoked' || row.status === 'suspended') acc.blocked += 1;
    return acc;
  }, { total: 0, active: 0, expired: 0, blocked: 0 });

  const licenseByClinic = licenseTable.rows.reduce((acc, row) => {
    acc[row.clinic_id] = row;
    return acc;
  }, {});
  const latestLogs = getRecentSheetRows_(spreadsheet.getSheetByName(LOG_SHEET), DASHBOARD_LOG_LIMIT)
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
  const latestFeedback = getRecentSheetRows_(spreadsheet.getSheetByName(FEEDBACK_SHEET), DASHBOARD_ERROR_LIMIT)
    .map((row) => ({
      ...row,
      status: FEEDBACK_STATUSES.indexOf(row.status) === -1 ? 'new' : row.status,
    }))
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));

  return {
    message: 'Snapshot dashboard berhasil diambil.',
    data: {
      summary: {
        ...summary,
        total_error_report: countDataRows_(spreadsheet.getSheetByName(FEEDBACK_SHEET)),
      },
      licenses: licenses.slice(0, DEFAULT_PAGE_LIMIT),
      feedback: latestFeedback,
      logs: latestLogs,
    },
    meta: {
      licenses: { limit: DEFAULT_PAGE_LIMIT, offset: 0, total: licenses.length },
      feedback: { limit: DASHBOARD_ERROR_LIMIT, offset: 0, total: latestFeedback.length },
      logs: { limit: DASHBOARD_LOG_LIMIT, offset: 0, total: latestLogs.length },
    },
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

function getRecentSheetRows_(sheet, limit) {
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT));
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];

  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const startRow = Math.max(2, lastRow - normalizedLimit + 1);
  const rowCount = lastRow - startRow + 1;
  const values = sheet.getRange(startRow, 1, rowCount, lastColumn).getDisplayValues();

  return values
    .filter((row) => row.some(Boolean))
    .map((row) => headers.reduce((acc, header, index) => {
      acc[header] = row[index] || '';
      return acc;
    }, {}));
}

function countDataRows_(sheet) {
  return Math.max(0, sheet.getLastRow() - 1);
}

function normalizeLimitOffset_(body) {
  const limit = Math.max(1, Math.min(Number(body.limit) || DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT));
  let offset = Number(body.offset);
  if (!Number.isFinite(offset) && body.page !== undefined) {
    const page = Math.max(1, Number(body.page) || 1);
    offset = (page - 1) * limit;
  }
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  return {
    limit,
    offset: Math.floor(offset),
  };
}

function paginatedRows_(rows, limit, offset) {
  return {
    rows: rows.slice(offset, offset + limit),
    total: rows.length,
  };
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

function incrementDeviceMismatch_(sheet, table, rowIndex) {
  const currentValue = Number(table.rows[rowIndex].mismatch_count || 0);
  const nextValue = Number.isFinite(currentValue) ? currentValue + 1 : 1;
  if (table.headerMap.mismatch_count !== undefined) {
    sheet.getRange(rowIndex + 2, table.headerMap.mismatch_count + 1).setValue(nextValue);
  }
  return nextValue;
}

function resetDeviceMismatchCount_(sheet, table, rowIndex) {
  if (table.headerMap.mismatch_count !== undefined) {
    sheet.getRange(rowIndex + 2, table.headerMap.mismatch_count + 1).setValue(0);
  }
}

function updatePinResetStatus_(sheet, table, rowIndex, status, confirmedAt, note) {
  const sheetRow = rowIndex + 2;
  if (table.headerMap.status !== undefined) {
    sheet.getRange(sheetRow, table.headerMap.status + 1).setValue(status);
  }
  if (confirmedAt && table.headerMap.confirmed_at !== undefined) {
    sheet.getRange(sheetRow, table.headerMap.confirmed_at + 1).setValue(confirmedAt);
  }
  if (note && table.headerMap.note !== undefined) {
    sheet.getRange(sheetRow, table.headerMap.note + 1).setValue(note);
  }
}

function withScriptLock_(callback) {
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    lock.waitLock(LOCK_WAIT_MS);
    locked = true;
    return callback();
  } finally {
    if (locked) {
      lock.releaseLock();
    }
  }
}

function getCache_() {
  return CacheService.getScriptCache();
}

function makeLicenseCacheKey_(clinicId, licenseKey, deviceId) {
  return makeVerifyCacheKey_(clinicId, licenseKey, deviceId);
}

function makeVerifyCacheKey_(clinicId, licenseKey, deviceId) {
  const version = getLicenseCacheVersion_(clinicId, licenseKey);
  const keySource = [
    'verify',
    version,
    clinicId,
    licenseKey,
    deviceId || 'no-device',
  ].join('|');
  return 'lic:' + Utilities.base64EncodeWebSafe(keySource).slice(0, 220);
}

function makeErrorRateLimitKey_(clinicId, deviceId, errorMessage) {
  const source = [
    'error_report',
    clinicId || 'no-clinic',
    deviceId || 'no-device',
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, errorMessage || '')
      .map((byte) => (byte + 256).toString(16).slice(-2))
      .join(''),
  ].join('|');
  return 'err:' + Utilities.base64EncodeWebSafe(source).slice(0, 220);
}

function findLicenseForPinReset_(clinicId, licenseKey) {
  const sheet = getSpreadsheet_().getSheetByName(LICENSE_SHEET);
  const table = getTable_(sheet);
  return table.rows.find((row) => {
    if (row.license_key !== licenseKey) return false;
    return !clinicId || row.clinic_id === clinicId;
  }) || null;
}

function generateResetToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function generateResetPin_() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function isDateTimeExpired_(value) {
  const parsed = parseSheetDate_(value);
  return Boolean(parsed && parsed.getTime() < new Date().getTime());
}

function getLicenseCacheVersion_(clinicId, licenseKey) {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty(makeLicenseCacheVersionKey_(clinicId, licenseKey)) || '1';
}

function clearLicenseCache_(clinicId, licenseKey) {
  if (!clinicId || !licenseKey) return;
  const props = PropertiesService.getScriptProperties();
  props.setProperty(makeLicenseCacheVersionKey_(clinicId, licenseKey), String(new Date().getTime()));
}

function makeLicenseCacheVersionKey_(clinicId, licenseKey) {
  const source = ['license_cache_version', clinicId, licenseKey].join('|');
  return 'lcv_' + Utilities.base64EncodeWebSafe(source).slice(0, 220);
}

function getJsonCache_(cache, key) {
  const cached = cache.get(key);
  if (!cached) return null;
  try {
    return JSON.parse(cached);
  } catch (error) {
    return null;
  }
}

function putVerifyCache_(cache, key, result) {
  const valid = Boolean(result && result.data && result.data.valid);
  cache.put(key, JSON.stringify(result), valid ? VERIFY_CACHE_SECONDS : INVALID_VERIFY_CACHE_SECONDS);
}

function buildVerifyResult_(license, clinicId, licenseKey, deviceId, serverTime) {
  const expired = isExpired_(license.expired_at);
  const storedDeviceId = license.device_id || '';
  let valid = true;
  let reason = 'valid';
  let message = 'License valid.';

  if (license.status === 'suspended') {
    valid = false;
    reason = 'suspended';
    message = 'Lisensi disuspend.';
  } else if (license.status !== 'active') {
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

  return {
    message,
    data: {
      valid,
      reason,
      status: expired ? 'expired' : license.status,
      clinic_name: license.clinic_name || '',
      expired_at: license.expired_at || '',
      clinic_id: license.clinic_id || clinicId,
      license_key: license.license_key || licenseKey,
      device_id: deviceId || storedDeviceId || '',
      mismatch_count: Number(license.mismatch_count || 0),
      server_time: serverTime,
    },
  };
}

function makeVerifyPayload_(data, message) {
  const valid = Boolean(data && data.valid);
  const payload = {
    ok: valid,
    valid,
    ...(valid ? {
      license: {
        clinic_id: data.clinic_id || '',
        status: data.status || '',
        expires_at: data.expired_at || '',
        device_bound: Boolean(data.device_id),
      },
    } : {
      error: message || 'Lisensi tidak valid.',
    }),
    data: data || {},
    message: message || (valid ? 'License valid.' : 'Lisensi tidak valid.'),
  };

  return payload;
}

function shouldThrottleVerifyWrite_(lastCheckedAt) {
  const checkedAt = parseSheetDate_(lastCheckedAt);
  if (!checkedAt) return false;

  const elapsedMs = new Date().getTime() - checkedAt.getTime();
  return elapsedMs < VERIFY_WRITE_THROTTLE_HOURS * 60 * 60 * 1000;
}

function shouldWriteVerifyActivity_(license, valid, bindsDevice) {
  if (!valid) return true;
  if (bindsDevice) return true;
  return !shouldThrottleVerifyWrite_(license.last_checked_at);
}

function shouldWriteAuditLog_(action, result, payload) {
  if (result && result.skip_audit) return false;
  if (action !== 'verify_license') return true;
  return true;
}

function parseSheetDate_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return value;
  }

  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.indexOf('T') === -1 ? text.replace(' ', 'T') : text;
  const parsed = new Date(normalized);
  return isNaN(parsed.getTime()) ? null : parsed;
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
  const mismatchCount = payload.mismatch_count || audit.mismatch_count || body.mismatch_count || '';

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
    mismatchCount,
  ]);
}

function getAuditStatus_(action, payload) {
  if (action === 'verify_license') {
    return payload.data && payload.data.valid ? 'success' : 'failed';
  }

  return payload.ok ? 'success' : 'failed';
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
  if (status === 'blocked' || status === 'revoked' || status === 'suspended') return status;
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
  const sanitized = normalizeText_(value);
  if (sanitized === '') {
    throw new Error('Field ' + field + ' wajib diisi.');
  }

  return sanitized;
}

function optionalString_(value) {
  return normalizeText_(value);
}

function sanitizeString_(value) {
  return normalizeText_(value);
}

function normalizeText_(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

function validateStatus_(value) {
  const status = required_(value, 'status').toLowerCase();
  if (ALLOWED_STATUSES.indexOf(status) === -1) {
    throw new Error('Status tidak valid. Gunakan active, suspended, blocked, revoked, atau expired.');
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

function addMinutesIso_(minutes) {
  const date = new Date();
  date.setMinutes(date.getMinutes() + minutes);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
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
