import { isAdminRequestAuthenticated } from './admin-auth.js';

const PUBLIC_ACTIONS = [
  'verify_license',
  'report_feedback',
  'report_error',
  'request_admin_pin_reset',
  'confirm_admin_pin_reset',
];

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return sendJson_(response, 405, {
      ok: false,
      success: false,
      message: 'Method tidak diizinkan. Gunakan POST.',
    });
  }

  const gasApiUrl = process.env.GAS_API_URL;
  const gasApiSecret = process.env.GAS_API_SECRET;

  if (!gasApiUrl || !gasApiSecret) {
    return sendJson_(response, 500, {
      ok: false,
      success: false,
      message: 'GAS_API_URL atau GAS_API_SECRET belum diset di server.',
    });
  }

  try {
    const body = await readJsonBody_(request);
    const action = String(body.action || '');
    if (!PUBLIC_ACTIONS.includes(action) && !isAdminRequestAuthenticated(request)) {
      return sendJson_(response, 401, {
        ok: false,
        success: false,
        message: 'Silakan login admin terlebih dahulu.',
      });
    }

    const clientIp = getClientIp_(request);
    const gasResponse = await fetch(gasApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify({
        ...body,
        ip: body.ip || clientIp,
        secret_key: gasApiSecret,
      }),
    });

    const text = await gasResponse.text();
    let payload;

    try {
      payload = JSON.parse(text);
    } catch (error) {
      return sendJson_(response, 502, {
        ok: false,
        success: false,
        message: `Response GAS bukan JSON valid: ${text.slice(0, 120)}`,
      });
    }

    return sendJson_(response, gasResponse.ok ? 200 : gasResponse.status, normalizeResponse_(payload));
  } catch (error) {
    return sendJson_(response, 500, {
      ok: false,
      success: false,
      message: error.message || 'Proxy gagal memproses request.',
    });
  }
}

function getClientIp_(request) {
  const headers = request.headers || {};
  const fromHeader = (
    getHeader_(headers, 'x-forwarded-for') ||
    getHeader_(headers, 'x-real-ip') ||
    getHeader_(headers, 'cf-connecting-ip') ||
    getHeader_(headers, 'true-client-ip') ||
    ''
  );
  const rawIp = Array.isArray(fromHeader) ? fromHeader[0] : String(fromHeader);
  const firstIp = rawIp.split(',')[0].trim();

  return firstIp || request.socket?.remoteAddress || '';
}

function getHeader_(headers, name) {
  if (typeof headers.get === 'function') {
    return headers.get(name) || '';
  }

  return headers[name] || headers[name.toLowerCase()] || '';
}

async function readJsonBody_(request) {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    return request.body;
  }

  if (typeof request.body === 'string') {
    return request.body ? JSON.parse(request.body) : {};
  }

  if (Buffer.isBuffer(request.body)) {
    const rawBuffer = request.body.toString('utf8');
    return rawBuffer ? JSON.parse(rawBuffer) : {};
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};

  return JSON.parse(raw);
}

function normalizeResponse_(payload) {
  if (payload && typeof payload === 'object') {
    const hasOk = typeof payload.ok === 'boolean';
    const hasSuccess = typeof payload.success === 'boolean';

    if (hasOk || hasSuccess) {
      const ok = hasOk ? payload.ok : payload.success;
      const message = payload.message || payload.error || (ok ? 'Request berhasil.' : 'Request gagal.');
      return {
        ...payload,
        ok,
        success: ok,
        message,
      };
    }
  }

  return {
    ok: false,
    success: false,
    error: 'Format response GAS tidak sesuai.',
    message: 'Format response GAS tidak sesuai.',
  };
}

function sendJson_(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}
