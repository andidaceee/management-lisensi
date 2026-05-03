import crypto from 'node:crypto';

const COOKIE_NAME = 'bekam_admin_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return sendJson_(response, 405, {
      success: false,
      message: 'Method tidak diizinkan. Gunakan POST.',
    });
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  const sessionSecret = getSessionSecret_();

  if (!adminPassword || !sessionSecret) {
    return sendJson_(response, 500, {
      success: false,
      message: 'ADMIN_PASSWORD atau ADMIN_SESSION_SECRET belum diset di server.',
    });
  }

  try {
    const body = await readJsonBody_(request);
    const action = String(body.action || 'session');

    if (action === 'session') {
      return sendJson_(response, 200, {
        success: true,
        message: 'Status login berhasil dicek.',
        data: { authenticated: isAuthenticated_(request, sessionSecret) },
      });
    }

    if (action === 'logout') {
      setCookie_(response, `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      return sendJson_(response, 200, {
        success: true,
        message: 'Logout berhasil.',
        data: { authenticated: false },
      });
    }

    if (action !== 'login') {
      return sendJson_(response, 400, {
        success: false,
        message: 'Action auth tidak dikenal.',
      });
    }

    if (!constantTimeEqual_(String(body.password || ''), adminPassword)) {
      return sendJson_(response, 401, {
        success: false,
        message: 'Password admin salah.',
      });
    }

    const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
    const token = signSession_(expiresAt, sessionSecret);
    setCookie_(
      response,
      `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    );

    return sendJson_(response, 200, {
      success: true,
      message: 'Login berhasil.',
      data: { authenticated: true },
    });
  } catch (error) {
    return sendJson_(response, 500, {
      success: false,
      message: error.message || 'Auth gagal memproses request.',
    });
  }
}

export function isAdminRequestAuthenticated(request) {
  const sessionSecret = getSessionSecret_();
  return Boolean(sessionSecret && isAuthenticated_(request, sessionSecret));
}

function getSessionSecret_() {
  return process.env.ADMIN_SESSION_SECRET || process.env.GAS_API_SECRET || '';
}

function isAuthenticated_(request, sessionSecret) {
  const token = getCookie_(request, COOKIE_NAME);
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const expiresAt = Number(parts[0]);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = createSignature_(String(expiresAt), sessionSecret);
  return constantTimeEqual_(parts[1], expected);
}

function signSession_(expiresAt, sessionSecret) {
  return `${expiresAt}.${createSignature_(String(expiresAt), sessionSecret)}`;
}

function createSignature_(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function constantTimeEqual_(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getCookie_(request, name) {
  const cookieHeader = getHeader_(request.headers || {}, 'cookie');
  return String(cookieHeader || '')
    .split(';')
    .map((item) => item.trim())
    .reduce((found, cookie) => {
      if (found) return found;
      const separatorIndex = cookie.indexOf('=');
      if (separatorIndex === -1) return '';
      const cookieName = cookie.slice(0, separatorIndex);
      return cookieName === name ? cookie.slice(separatorIndex + 1) : '';
    }, '');
}

function getHeader_(headers, name) {
  if (typeof headers.get === 'function') {
    return headers.get(name) || '';
  }

  return headers[name] || headers[name.toLowerCase()] || '';
}

function setCookie_(response, cookie) {
  response.setHeader('Set-Cookie', cookie);
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

function sendJson_(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}
