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
- Update status lisensi: `active`, `suspended`, `blocked`, `revoked`, `expired`.
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

Admin dashboard memakai cookie session HTTP-only. Action publik untuk aplikasi
desktop adalah `verify_license`, `report_feedback`, alias `report_error`,
`request_admin_pin_reset`, dan `confirm_admin_pin_reset`. Action admin seperti
`dashboard_snapshot`, `list_licenses`, `register_clinic`, `create_license`,
`update_license`, `reset_device`, `delete_license`, `revoke_license`,
`block_license`, `list_logs`, `list_feedback`, `list_error_reports`,
`update_feedback_status`, dan `list_admin_pin_reset_requests` wajib login admin.

## API Actions

Semua request memakai POST JSON body:

- `register_clinic`
- `verify_license`
- `update_license`
- `list_licenses`
- `dashboard_snapshot`
- `reset_device`
- `delete_license`
- `revoke_license`
- `block_license`
- `report_feedback`
- `report_error`
- `request_admin_pin_reset`
- `confirm_admin_pin_reset`
- `list_admin_pin_reset_requests`

Detail backend ada di `gas/README.md`.

Semua response sukses dan gagal menyertakan dua flag kompatibilitas: `ok` dan
`success`. Keduanya selalu bernilai sama. Untuk `verify_license`, nilai flag
mengikuti validitas lisensi; untuk action admin, `true` berarti request berhasil
diproses.

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
  "success": true,
  "message": "Data license berhasil diambil.",
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
  "success": true,
  "valid": true,
  "message": "License valid.",
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
  "success": false,
  "valid": false,
  "error": "License sudah expired.",
  "message": "License sudah expired.",
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
  "success": true,
  "message": "Laporan error berhasil dikirim"
}
```
