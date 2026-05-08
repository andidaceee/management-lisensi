# License Management Aplikasi Klinik Bekam

Project sederhana untuk mengelola lisensi aplikasi klinik bekam.

## Stack

- Frontend: Vite + React
- Deploy frontend: Vercel dari GitHub
- Backend: Google Apps Script Web App
- Database: Google Sheets

## Struktur

```text
license-management/
├── frontend/
│   ├── src/
│   ├── index.html
│   ├── main.js
│   └── .env
├── gas/
│   ├── Code.gs
│   └── README.md
└── docs/
```

## Fitur Minimal

- Generate license key otomatis saat klinik didaftarkan.
- Verifikasi lisensi dari aplikasi desktop.
- Update status lisensi: `trial`, `active`, `expired`, `blocked`.
- Set tanggal expired.
- Log sederhana untuk register, update, dan verify.

## Menjalankan Frontend

```bash
cd frontend
npm install
npm run dev
```

Isi `frontend/.env` untuk menjalankan proxy lokal atau set langsung di Vercel:

```text
GAS_API_URL=https://script.google.com/macros/s/xxxxx/exec
GAS_API_SECRET=secret-acak-yang-sama-dengan-gas
ADMIN_PASSWORD=password-admin
ADMIN_SESSION_SECRET=secret-session-acak
```

Admin dashboard memakai cookie session HTTP-only. Action publik hanya
`verify_license`, `report_feedback`, alias `report_error`,
`request_admin_pin_reset`, dan `confirm_admin_pin_reset`. Action admin seperti
`list_licenses`, `register_clinic`, `create_license`, `update_license`,
`reset_device`, `delete_license`, `revoke_license`, `block_license`, `list_logs`,
`list_feedback`, `list_error_reports`, `list_admin_pin_reset_requests`,
`update_feedback_status`, dan `dashboard_snapshot` wajib login admin.

## API Actions

Semua request memakai POST JSON body:

- `register_clinic`
- `verify_license`
- `update_license`
- `list_licenses`
- `dashboard_snapshot`
- `report_feedback`
- `report_error`
- `request_admin_pin_reset`
- `confirm_admin_pin_reset`

Detail backend ada di `gas/README.md`.

## Kontrak Dashboard Snapshot

`dashboard_snapshot` adalah action admin untuk mengambil data dashboard dalam satu
request. Response `data` berisi ringkasan lisensi dan data terbaru yang dibatasi:

```json
{
  "summary": {
    "total": 1000,
    "active": 940,
    "expired": 40,
    "blocked": 20,
    "total_error_report": 12
  },
  "licenses": [],
  "feedback": [],
  "logs": []
}
```

Frontend admin memakai action ini untuk login, refresh, register, update lisensi,
reset device, dan update status feedback. Action ini tetap wajib melewati session
admin di proxy `/api/gas`.

## Kontrak Pagination

`list_licenses`, `list_feedback`, dan `list_logs` mendukung `limit` dan `offset`.
`list_licenses` juga mendukung `search` dan `status`. Default `limit` adalah 50
dan maksimum 200.

```json
{
  "ok": true,
  "data": [],
  "meta": {
    "limit": 50,
    "offset": 0,
    "total": 1000
  }
}
```

## Kontrak Verify License

`verify_license` tetap menjadi action publik untuk aplikasi desktop. Response valid
tetap memakai bentuk:

```json
{
  "ok": true,
  "valid": true,
  "license": {
    "clinic_id": "CLN-12345678",
    "status": "active",
    "expires_at": "2027-05-02",
    "device_bound": true
  },
  "data": {
    "valid": true,
    "reason": "valid",
    "status": "active",
    "clinic_name": "Klinik Bekam Sehat",
    "expired_at": "2027-05-02",
    "clinic_id": "CLN-12345678",
    "license_key": "BKM-XXXX-XXXX-XXXX-XXXX-XXXX",
    "device_id": "DEVICE-001",
    "server_time": "2026-05-08 10:00:00"
  }
}
```

Response gagal:

```json
{
  "ok": false,
  "valid": false,
  "error": "License sudah expired.",
  "data": {
    "valid": false,
    "reason": "expired"
  }
}
```

Backend men-throttle penulisan `last_checked_at`, `logs`, dan `audit_logs` untuk
verifikasi valid selama 6 jam. Verifikasi invalid, lisensi tidak ditemukan, dan
binding device baru tetap dicatat agar audit admin tetap aman.

`device_id` bersifat opsional. Jika dikirim dan lisensi belum punya device, backend
akan binding device pertama dengan `LockService`. Jika tidak dikirim, backend hanya
memverifikasi `clinic_id` dan `license_key` tanpa menyimpan device kosong.

## Kontrak Error Report

`report_feedback` dan `report_error` menerima laporan error publik dengan
`error_message` wajib. Field opsional seperti `clinic_id`, `license_key`,
`device_id`, `app_version`, `error_type`, `source`, `stack`, dan `context` akan
di-trim dan dipotong panjangnya. Laporan error yang sama dari device yang sama
dibatasi dengan rate limit 120 detik.

```json
{
  "ok": true,
  "message": "Laporan error berhasil dikirim"
}
```

## Kontrak Reset PIN Admin

`request_admin_pin_reset` adalah action publik untuk aplikasi lokal. Request wajib
mengirim `license_key`; field opsional: `clinic_id`, `device_id`, `admin_pin`,
`app_name`, `app_version`, `os_name`, dan `message`. Backend membuat baris di sheet
`admin_pin_resets` dengan status `pending`, `reset_token`, `reset_pin` sekali pakai,
dan masa berlaku 30 menit. Response publik tidak mengembalikan `reset_pin`.

```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "status": "pending",
    "reset_token": "token",
    "expires_at": "2026-05-08 12:30:00"
  }
}
```

`confirm_admin_pin_reset` adalah action publik untuk validasi dari aplikasi lokal.
Kirim `reset_token` dan `reset_pin` yang diberikan admin. Token yang valid akan
ditandai `confirmed`; token expired atau sudah dipakai akan ditolak.

Admin dashboard atau integrasi admin bisa memakai action login
`list_admin_pin_reset_requests` untuk melihat request dan kode `reset_pin`.
