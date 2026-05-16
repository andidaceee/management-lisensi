import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { apiRequest, authRequest } from './api.js';

const emptyForm = {
  clinic_name: '',
  clinic_phone: '',
  duration: '3_days',
};

const statusOptions = ['active', 'suspended', 'blocked', 'expired'];
const tabs = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'licenses', label: 'List Klinik' },
  { id: 'pin-reset', label: 'Reset PIN' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'add', label: 'Tambah Klinik' },
];
const durationOptions = [
  { value: '3_days', label: '3 hari' },
  { value: '1_month', label: '1 bulan' },
  { value: '1_year', label: '1 tahun' },
  { value: 'lifetime', label: 'Lifetime' },
];
const feedbackStatusOptions = ['new', 'reviewing', 'resolved', 'ignored'];

function getExpiredAt(duration) {
  if (duration === 'lifetime') return '';

  const date = new Date();
  if (duration === '1_month') {
    date.setMonth(date.getMonth() + 1);
  } else if (duration === '1_year') {
    date.setFullYear(date.getFullYear() + 1);
  } else {
    date.setDate(date.getDate() + 3);
  }

  // Return a local date-only string YYYY-MM-DD without timezone conversion
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDate(value) {
  if (!value) return 'Lifetime';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(value) {
  if (!value) return '-';
  const normalized = String(value).includes('T') ? value : String(value).replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toDateInputValue(value) {
  if (!value) return '';
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return '';
}

function toDateOnly(value) {
  if (!value) return '';
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return '';
}

function toDateOnlyLocal(value) {
  if (!value) return '';
  const s = String(value).trim();
  // If value contains time information, parse and convert to local date
  if (s.includes('T')) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    }
  }
  return toDateOnly(s);
}

function statusLabel(status) {
  return status || 'unknown';
}

function feedbackStatusLabel(status) {
  const labels = {
    new: 'Baru',
    reviewing: 'Dicek',
    resolved: 'Selesai',
    ignored: 'Diabaikan',
  };
  return labels[status] || status || 'Baru';
}

function pinResetStatusLabel(status) {
  const labels = {
    pending: 'Menunggu',
    confirmed: 'Dipakai',
    expired: 'Expired',
  };
  return labels[status] || status || 'Menunggu';
}

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [licenses, setLicenses] = useState([]);
  const [licenseSummary, setLicenseSummary] = useState(null);
  const [feedback, setFeedback] = useState([]);
  const [pinResetRequests, setPinResetRequests] = useState([]);
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resettingKey, setResettingKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);

  const summary = useMemo(() => {
    if (licenseSummary) {
      return {
        total: Number(licenseSummary.total) || 0,
        active: Number(licenseSummary.active) || 0,
        suspended: 0,
        expired: Number(licenseSummary.expired) || 0,
        blocked: Number(licenseSummary.blocked) || 0,
        boundDevices: licenses.filter((item) => item.device_id).length,
      };
    }

    return licenses.reduce(
      (acc, item) => {
        acc.total += 1;
        if (item.status === 'active') acc.active += 1;
        if (item.status === 'suspended') acc.suspended += 1;
        if (item.status === 'expired') acc.expired += 1;
        if (item.status === 'blocked') acc.blocked += 1;
        if (item.device_id) acc.boundDevices += 1;
        return acc;
      },
      { total: 0, active: 0, suspended: 0, expired: 0, blocked: 0, boundDevices: 0 },
    );
  }, [licenses, licenseSummary]);

  const feedbackSummary = useMemo(() => {
    return feedback.reduce(
      (acc, item) => {
        acc.total += 1;
        if (item.status === 'new') acc.new += 1;
        if (item.status === 'reviewing') acc.reviewing += 1;
        if (item.status === 'resolved') acc.resolved += 1;
        if (item.severity === 'critical') acc.critical += 1;
        return acc;
      },
      { total: 0, new: 0, reviewing: 0, resolved: 0, critical: 0 },
    );
  }, [feedback]);

  const pinResetSummary = useMemo(() => {
    return pinResetRequests.reduce(
      (acc, item) => {
        acc.total += 1;
        const status = item.status || 'pending';
        if (status === 'pending') acc.pending += 1;
        if (status === 'confirmed') acc.confirmed += 1;
        if (status === 'expired') acc.expired += 1;
        return acc;
      },
      { total: 0, pending: 0, confirmed: 0, expired: 0 },
    );
  }, [pinResetRequests]);

  const logSummary = useMemo(() => {
    return logs.reduce(
      (acc, item) => {
        acc.total += 1;
        if (item.ip) acc.withIp += 1;
        if (String(item.action || '').includes('failed') || String(item.action || '').includes('invalid')) {
          acc.failed += 1;
        }
        return acc;
      },
      { total: 0, withIp: 0, failed: 0 },
    );
  }, [logs]);

  const attentionLicenses = useMemo(() => {
    return licenses
      .filter((item) => item.status !== 'active' || !item.device_id)
      .slice(0, 5);
  }, [licenses]);

  async function refreshAll() {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('dashboard_snapshot');
      setLicenseSummary(data.summary || null);
      setLicenses(data.licenses || []);
      setFeedback(data.feedback || []);
      setLogs(data.logs || []);
      try {
        const resetData = await apiRequest('list_admin_pin_reset_requests', { limit: 100 });
        setPinResetRequests(Array.isArray(resetData) ? resetData : (resetData.requests || []));
      } catch (resetErr) {
        setPinResetRequests([]);
      }
    } catch (err) {
      setError(err.message || 'Gagal mengambil data lisensi.');
      setFeedback([]);
      setPinResetRequests([]);
      setLogs([]);
      setLicenseSummary(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function checkSession() {
      try {
        const data = await authRequest('session');
        if (!mounted) return;
        setAuthenticated(Boolean(data.authenticated));
        if (data.authenticated) {
          await refreshAll();
        }
      } catch (err) {
        if (mounted) {
          setAuthenticated(false);
          setError(err.message || 'Gagal mengecek sesi admin.');
        }
      } finally {
        if (mounted) setAuthChecked(true);
      }
    }

    checkSession();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleLogin(event) {
    event.preventDefault();
    setLoggingIn(true);
    setError('');
    setMessage('');
    try {
      await authRequest('login', { password: loginPassword });
      setAuthenticated(true);
      setLoginPassword('');
      setMessage('Login admin berhasil.');
      await refreshAll();
    } catch (err) {
      setError(err.message || 'Login admin gagal.');
    } finally {
      setLoggingIn(false);
      setAuthChecked(true);
    }
  }

  async function handleLogout() {
    setError('');
    setMessage('');
    try {
      await authRequest('logout');
    } catch (err) {
      setError(err.message || 'Logout gagal.');
    } finally {
      setAuthenticated(false);
      setLicenses([]);
      setLicenseSummary(null);
      setFeedback([]);
      setPinResetRequests([]);
      setLogs([]);
      setActiveTab('dashboard');
      setEditing(null);
      setMessage('');
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const data = await apiRequest('register_clinic', {
        clinic_name: form.clinic_name,
        clinic_phone: form.clinic_phone,
        expired_at: getExpiredAt(form.duration),
      });
      setMessage(`Lisensi dibuat untuk ${form.clinic_name}: ${data.license_key}`);
      setForm(emptyForm);
      await refreshAll();
    } catch (err) {
      setError(err.message || 'Gagal menambah klinik.');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(event) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        license_key: editing.license_key,
        status: editing.status,
        // send date-only YYYY-MM-DD to backend without timezone conversion
        expired_at: editing.expired_at || toDateOnly(editing.expired_at) || '',
      };
      await apiRequest('update_license', payload);
      setMessage(`Lisensi ${editing.license_key} diperbarui.`);
      setEditing(null);
      await refreshAll();
    } catch (err) {
      setError(err.message || 'Gagal memperbarui lisensi.');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetDevice(item) {
    const confirmed = window.confirm(`Reset device untuk ${item.clinic_name}? Device baru akan bisa aktivasi ulang dengan lisensi ini.`);
    if (!confirmed) return;

    setResettingKey(item.license_key);
    setError('');
    setMessage('');
    try {
      await apiRequest('reset_device', {
        license_key: item.license_key,
      });
      setMessage(`Device ${item.clinic_name} berhasil direset.`);
      await refreshAll();
    } catch (err) {
      setError(err.message || 'Gagal reset device.');
    } finally {
      setResettingKey('');
    }
  }

  async function handleFeedbackStatus(item, status) {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await apiRequest('update_feedback_status', {
        id: item.id,
        status,
        note: item.note || '',
      });
      setMessage(`Feedback ${item.clinic_name || item.app_name || item.id} ditandai ${feedbackStatusLabel(status)}.`);
      await refreshAll();
    } catch (err) {
      setError(err.message || 'Gagal memperbarui feedback.');
    } finally {
      setSaving(false);
    }
  }

  function handleFeedbackNoteChange(id, note) {
    setFeedback((items) => items.map((item) => (item.id === id ? { ...item, note } : item)));
  }

  if (!authChecked) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <p className="eyebrow">Bekam Clinic</p>
          <h1>Memeriksa sesi admin</h1>
          <p className="muted">Sebentar, dashboard sedang menyiapkan akses.</p>
        </section>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div>
            <p className="eyebrow">Bekam Clinic</p>
            <h1>Login Admin</h1>
            <p className="muted">Masuk untuk mengelola lisensi, feedback, dan log klinik.</p>
          </div>
          {error && <div className="notice error">{error}</div>}
          <form onSubmit={handleLogin}>
            <label>
              Password admin
              <input
                required
                type="password"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="Masukkan password admin"
              />
            </label>
            <button type="submit" disabled={loggingIn}>
              {loggingIn ? 'Masuk...' : 'Masuk Admin'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Bekam Clinic</p>
          <h1>License Management</h1>
        </div>
        <nav aria-label="Menu utama">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <button className="ghost-button" onClick={refreshAll} disabled={loading}>
          Refresh
        </button>
        <button className="ghost-button" onClick={handleLogout}>
          Logout
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Google Sheets + GAS</p>
            <h2>Kontrol lisensi aplikasi klinik</h2>
          </div>
          <div className="topbar-actions">
            {feedbackSummary.new > 0 && (
              <button type="button" className="feedback-alert" onClick={() => setActiveTab('feedback')}>
                {feedbackSummary.new} error baru
              </button>
            )}
            {pinResetSummary.pending > 0 && (
              <button type="button" className="pin-alert" onClick={() => setActiveTab('pin-reset')}>
                {pinResetSummary.pending} reset PIN
              </button>
            )}
            <span className="api-chip">Proxy /api/gas</span>
          </div>
        </header>

        {message && <div className="notice success">{message}</div>}
        {error && <div className="notice error">{error}</div>}

        {activeTab === 'dashboard' && (
          <section className="tab-view" aria-label="Dashboard">
            <section className="summary-grid" aria-label="Ringkasan lisensi">
              <div className="metric primary">
                <span>Jumlah Klinik</span>
                <strong>{summary.total}</strong>
              </div>
              <div className="metric">
                <span>Aktif</span>
                <strong>{summary.active}</strong>
              </div>
              <div className="metric">
                <span>Device Terikat</span>
                <strong>{summary.boundDevices}</strong>
              </div>
              <div className="metric danger">
                <span>Perlu Cek</span>
                <strong>{summary.expired + summary.blocked + summary.suspended}</strong>
              </div>
              <button type="button" className="metric feedback-metric" onClick={() => setActiveTab('feedback')}>
                <span>Feedback Error</span>
                <strong>{feedbackSummary.new}</strong>
              </button>
              <button type="button" className="metric pin-metric" onClick={() => setActiveTab('pin-reset')}>
                <span>Reset PIN</span>
                <strong>{pinResetSummary.pending}</strong>
              </button>
              <div className="metric">
                <span>Log IP</span>
                <strong>{logSummary.withIp}</strong>
              </div>
            </section>

            <section className="dashboard-grid">
              <div className="panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Status Operasional</p>
                    <h3>Distribusi lisensi</h3>
                  </div>
                  <span>{loading ? 'Memuat...' : `${licenses.length} data`}</span>
                </div>
                <div className="status-board">
                  <div>
                    <span className="status active">active</span>
                    <strong>{summary.active}</strong>
                  </div>
                  <div>
                    <span className="status suspended">suspended</span>
                    <strong>{summary.suspended}</strong>
                  </div>
                  <div>
                    <span className="status expired">expired</span>
                    <strong>{summary.expired}</strong>
                  </div>
                  <div>
                    <span className="status blocked">blocked</span>
                    <strong>{summary.blocked}</strong>
                  </div>
                </div>
              </div>

              <div className="panel activity-panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Log Aktivitas</p>
                    <h3>Aktivitas terbaru</h3>
                  </div>
                  <span>{loading ? 'Memuat...' : `${logSummary.total} log`}</span>
                </div>
                <div className="activity-list">
                  {!loading && logs.length === 0 && (
                    <p className="empty compact">Belum ada log aktivitas.</p>
                  )}
                  {logs.slice(0, 8).map((item) => (
                    <div key={item.id || `${item.timestamp}-${item.action}`} className="activity-item">
                      <span>
                        <strong>{item.action || 'activity'}</strong>
                        <small>{item.clinic_name || item.clinic_id || item.license_key || 'Tidak ada klinik'}</small>
                      </span>
                      <span className="activity-meta">
                        <span className="mono">{item.ip || 'IP kosong'}</span>
                        <small>{item.timestamp || '-'}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Perlu Tindakan</p>
                    <h3>Klinik prioritas</h3>
                  </div>
                  <button type="button" className="small-button" onClick={() => setActiveTab('licenses')}>
                    Lihat semua
                  </button>
                </div>
                <div className="priority-list">
                  {!loading && attentionLicenses.length === 0 && (
                    <p className="empty compact">Semua lisensi aktif dan device sudah terikat.</p>
                  )}
                  {attentionLicenses.map((item) => (
                    <button
                      key={item.id || item.license_key}
                      type="button"
                      className="priority-item"
                      onClick={() => setActiveTab('licenses')}
                    >
                      <span>
                        <strong>{item.clinic_name}</strong>
                        <small>{item.device_id ? item.license_key : 'Device belum terikat'}</small>
                      </span>
                      <span className={`status ${item.status}`}>{statusLabel(item.status)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Feedback Aplikasi</p>
                    <h3>Error terbaru</h3>
                  </div>
                  <button type="button" className="small-button" onClick={() => setActiveTab('feedback')}>
                    Lihat feedback
                  </button>
                </div>
                <div className="priority-list">
                  {!loading && feedback.length === 0 && (
                    <p className="empty compact">Belum ada laporan error dari aplikasi.</p>
                  )}
                  {feedback.slice(0, 4).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="priority-item"
                      onClick={() => setActiveTab('feedback')}
                    >
                      <span>
                        <strong>{item.clinic_name || item.app_name || 'Aplikasi'}</strong>
                        <small>{item.message || item.error_type || 'Error tanpa pesan'}</small>
                      </span>
                      <span className={`status feedback-${item.status}`}>{feedbackStatusLabel(item.status)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </section>
        )}

        {activeTab === 'add' && (
          <section className="panel two-column tab-view">
            <div>
              <p className="eyebrow">Tambah Klinik</p>
              <h3>Buat lisensi otomatis</h3>
              <p className="muted">License key dibuat di backend supaya tetap konsisten untuk semua admin.</p>
            </div>
            <form onSubmit={handleRegister}>
              <label>
                Nama klinik
                <input
                  required
                  value={form.clinic_name}
                  onChange={(event) => setForm({ ...form, clinic_name: event.target.value })}
                  placeholder="Contoh: Klinik Bekam Sehat"
                />
              </label>
              <label>
                Nomor HP
                <input
                  value={form.clinic_phone}
                  onChange={(event) => setForm({ ...form, clinic_phone: event.target.value })}
                  placeholder="Opsional"
                />
              </label>
              <label>
                Masa aktif
                <select
                  value={form.duration}
                  onChange={(event) => setForm({ ...form, duration: event.target.value })}
                >
                  {durationOptions.map((duration) => (
                    <option key={duration.value} value={duration.value}>{duration.label}</option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={saving}>
                {saving ? 'Menyimpan...' : 'Tambah Klinik'}
              </button>
            </form>
          </section>
        )}

        {activeTab === 'licenses' && (
          <section className="panel tab-view">
            <div className="section-heading">
              <div>
                <p className="eyebrow">List Klinik</p>
                <h3>Data lisensi</h3>
              </div>
              <span>{loading ? 'Memuat...' : `${licenses.length} data`}</span>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Clinic</th>
                    <th>License Key</th>
                    <th>Status</th>
                    <th>Device</th>
                    <th>Expired</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && licenses.length === 0 && (
                    <tr>
                      <td colSpan="6" className="empty">Belum ada lisensi.</td>
                    </tr>
                  )}
                  {licenses.map((item) => (
                    <tr key={item.id || item.license_key}>
                      <td>
                        <strong>{item.clinic_name}</strong>
                        <small>{item.clinic_id}</small>
                      </td>
                      <td className="mono">{item.license_key}</td>
                      <td>
                        <span className={`status ${item.status}`}>{statusLabel(item.status)}</span>
                      </td>
                      <td className="mono device-cell">{item.device_id || 'Belum terikat'}</td>
                      <td>{formatDate(item.expired_at)}</td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="small-button"
                            onClick={() => {
                              setEditing({
                                ...item,
                                expired_at: toDateOnlyLocal(item.expired_at || item.expires_at || item.expired),
                              });
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="small-button secondary"
                            onClick={() => handleResetDevice(item)}
                            disabled={resettingKey === item.license_key || !item.device_id}
                            title={!item.device_id ? 'Device belum terikat' : 'Reset device'}
                          >
                            {resettingKey === item.license_key ? 'Reset...' : 'Reset Device'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'pin-reset' && (
          <section className="panel tab-view">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Reset PIN Admin</p>
                <h3>Request dari aplikasi lokal</h3>
              </div>
              <span>{loading ? 'Memuat...' : `${pinResetSummary.pending} menunggu dari ${pinResetSummary.total} request`}</span>
            </div>

            <section className="feedback-stats pin-reset-stats" aria-label="Ringkasan reset PIN">
              <div>
                <span>Menunggu</span>
                <strong>{pinResetSummary.pending}</strong>
              </div>
              <div>
                <span>Dipakai</span>
                <strong>{pinResetSummary.confirmed}</strong>
              </div>
              <div>
                <span>Expired</span>
                <strong>{pinResetSummary.expired}</strong>
              </div>
              <div>
                <span>Total</span>
                <strong>{pinResetSummary.total}</strong>
              </div>
            </section>

            <div className="pin-reset-list">
              {!loading && pinResetRequests.length === 0 && (
                <p className="empty compact">Belum ada request reset PIN admin.</p>
              )}
              {pinResetRequests.map((item) => (
                <article key={item.id || item.reset_token} className="pin-reset-item">
                  <div className="pin-reset-main">
                    <div>
                      <p className="eyebrow">{formatDateTime(item.timestamp)}</p>
                      <h4>{item.clinic_name || item.clinic_id || 'Klinik tidak dikenal'}</h4>
                      <p className="muted mono">{item.license_key || '-'}</p>
                    </div>
                    <span className={`status pin-${item.status || 'pending'}`}>
                      {pinResetStatusLabel(item.status)}
                    </span>
                  </div>

                  <div className="pin-code-row">
                    <div>
                      <span>Reset PIN</span>
                      <strong className="mono">{item.reset_pin || '-'}</strong>
                    </div>
                    <div>
                      <span>Expired</span>
                      <strong>{formatDateTime(item.expires_at)}</strong>
                    </div>
                    <div>
                      <span>Device</span>
                      <strong className="mono">{item.device_id || '-'}</strong>
                    </div>
                    <div>
                      <span>App</span>
                      <strong>{[item.app_name, item.app_version, item.os_name].filter(Boolean).join(' / ') || '-'}</strong>
                    </div>
                  </div>

                  <dl className="feedback-meta pin-reset-meta">
                    <div>
                      <dt>Token</dt>
                      <dd className="mono">{item.reset_token || '-'}</dd>
                    </div>
                    <div>
                      <dt>IP</dt>
                      <dd className="mono">{item.ip || '-'}</dd>
                    </div>
                    <div>
                      <dt>Confirmed</dt>
                      <dd>{formatDateTime(item.confirmed_at)}</dd>
                    </div>
                    <div>
                      <dt>Pesan</dt>
                      <dd>{item.message || '-'}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'feedback' && (
          <section className="panel tab-view">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Feedback Error</p>
                <h3>Laporan dari aplikasi</h3>
              </div>
              <span>{loading ? 'Memuat...' : `${feedbackSummary.new} baru dari ${feedbackSummary.total} laporan`}</span>
            </div>

            <section className="feedback-stats" aria-label="Ringkasan feedback">
              <div>
                <span>Baru</span>
                <strong>{feedbackSummary.new}</strong>
              </div>
              <div>
                <span>Dicek</span>
                <strong>{feedbackSummary.reviewing}</strong>
              </div>
              <div>
                <span>Selesai</span>
                <strong>{feedbackSummary.resolved}</strong>
              </div>
              <div>
                <span>Kritis</span>
                <strong>{feedbackSummary.critical}</strong>
              </div>
            </section>

            <div className="feedback-list">
              {!loading && feedback.length === 0 && (
                <p className="empty compact">Belum ada feedback error.</p>
              )}
              {feedback.map((item) => (
                <article key={item.id} className="feedback-card">
                  <div className="feedback-card-head">
                    <div>
                      <p className="eyebrow">{item.timestamp || 'Tanpa waktu'}</p>
                      <h4>{item.clinic_name || item.app_name || 'Aplikasi tidak dikenal'}</h4>
                    </div>
                    <div className="feedback-badges">
                      <span className={`status feedback-${item.status}`}>{feedbackStatusLabel(item.status)}</span>
                      <span className={`status severity-${item.severity}`}>{item.severity || 'error'}</span>
                    </div>
                  </div>
                  <p className="feedback-message">{item.message || 'Tidak ada pesan error.'}</p>
                  <dl className="feedback-meta">
                    <div>
                      <dt>License</dt>
                      <dd className="mono">{item.license_key || '-'}</dd>
                    </div>
                    <div>
                      <dt>Device</dt>
                      <dd className="mono">{item.device_id || '-'}</dd>
                    </div>
                    <div>
                      <dt>Source</dt>
                      <dd>{item.source || item.error_type || '-'}</dd>
                    </div>
                    <div>
                      <dt>App</dt>
                      <dd>{[item.app_name, item.app_version, item.os_name].filter(Boolean).join(' / ') || '-'}</dd>
                    </div>
                    {item.status === 'resolved' && (
                      <div>
                        <dt>Selesai</dt>
                        <dd>{formatDateTime(item.resolved_at)}</dd>
                      </div>
                    )}
                  </dl>
                  {item.stack && <pre className="stack-preview">{item.stack}</pre>}
                  <label className="feedback-note">
                    Catatan tindak lanjut
                    <textarea
                      value={item.note || ''}
                      onChange={(event) => handleFeedbackNoteChange(item.id, event.target.value)}
                      placeholder="Contoh: sudah dihubungi, perlu update app, atau abaikan karena duplikat"
                      rows={3}
                    />
                  </label>
                  <div className="table-actions">
                    {feedbackStatusOptions.map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={`small-button ${item.status === status ? '' : 'secondary'}`}
                        onClick={() => handleFeedbackStatus(item, status)}
                        disabled={saving || item.status === status}
                      >
                        {feedbackStatusLabel(status)}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {editing && (
          <section className="panel two-column edit-panel">
            <div>
              <p className="eyebrow">Edit Lisensi</p>
              <h3>{editing.clinic_name}</h3>
              <p className="mono muted">{editing.license_key}</p>
            </div>
            <form onSubmit={handleUpdate}>
              <label>
                Status
                <select
                  value={editing.status}
                  onChange={(event) => setEditing({ ...editing, status: event.target.value })}
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </label>
              <label>
                Expired at
                <input
                  type="date"
                  value={editing?.expired_at || ''}
                  onChange={(event) => setEditing({ ...editing, expired_at: event.target.value })}
                />
              </label>
              <label>
                Masa aktif cepat
                <select
                  value=""
                  onChange={(event) => {
                    if (!event.target.value) return;
                    setEditing({ ...editing, expired_at: getExpiredAt(event.target.value) });
                  }}
                >
                  <option value="">Pilih masa aktif</option>
                  {durationOptions.map((duration) => (
                    <option key={duration.value} value={duration.value}>{duration.label}</option>
                  ))}
                </select>
              </label>
              <div className="button-row">
                <button type="submit" disabled={saving}>
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
                <button type="button" className="ghost-button" onClick={() => setEditing(null)}>
                  Batal
                </button>
              </div>
            </form>
          </section>
        )}
      </section>
    </main>
  );
}
