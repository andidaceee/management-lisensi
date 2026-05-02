const API_URL = '/api/gas';

export async function apiRequest(action, payload = {}) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Response API bukan JSON valid: ${text.slice(0, 120)}`);
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.message || 'Request API gagal.');
  }

  return data.data || {};
}
