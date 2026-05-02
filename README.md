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
```

## API Actions

Semua request memakai POST JSON body:

- `register_clinic`
- `verify_license`
- `update_license`
- `list_licenses`

Detail backend ada di `gas/README.md`.
