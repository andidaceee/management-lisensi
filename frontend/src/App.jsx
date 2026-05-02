import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './api.js';

const emptyForm = {
  clinic_name: '',
  clinic_phone: '',
  duration: '3_days',
};

const statusOptions = ['active', 'suspended', 'blocked', 'expired'];
const tabs = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'licenses', label: 'List Klinik' },
  { id: 'add', label: 'Tambah Klinik' },
];
const durationOptions = [
  { value: '3_days', label: '3 hari' },
  { value: '1_month', label: '1 bulan' },
  { value: '1_year', label: '1 tahun' },
  { value: 'lifetime', label: 'Lifetime' },
];

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

  return date.toISOString().slice(0, 10);
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

function statusLabel(status) {
  return status || 'unknown';
}

export default function App() {
  const [licenses, setLicenses] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resettingKey, setResettingKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);

  const summary = useMemo(() => {
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
  }, [licenses]);

  const attentionLicenses = useMemo(() => {
    return licenses
      .filter((item) => item.status !== 'active' || !item.device_id)
      .slice(0, 5);
  }, [licenses]);

  async function loadLicenses() {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('list_licenses');
      setLicenses(data.licenses || []);
    } catch (err) {
      setError(err.message || 'Gagal mengambil data lisensi.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLicenses();
  }, []);

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
      await loadLicenses();
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
      await apiRequest('update_license', {
        license_key: editing.license_key,
        status: editing.status,
        expired_at: editing.expired_at,
      });
      setMessage(`Lisensi ${editing.license_key} diperbarui.`);
      setEditing(null);
      await loadLicenses();
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
      await loadLicenses();
    } catch (err) {
      setError(err.message || 'Gagal reset device.');
    } finally {
      setResettingKey('');
    }
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
        <button className="ghost-button" onClick={loadLicenses} disabled={loading}>
          Refresh
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Google Sheets + GAS</p>
            <h2>Kontrol lisensi aplikasi klinik</h2>
          </div>
          <span className="api-chip">Proxy /api/gas</span>
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
                          <button className="small-button" onClick={() => setEditing(item)}>
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
                  value={(editing.expired_at || '').slice(0, 10)}
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
