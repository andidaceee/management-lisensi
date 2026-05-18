# GAS Backend

Backend ini memakai Google Apps Script Web App dan Google Sheets.

## Setup

1. Buat Google Spreadsheet baru.
2. Buka `Extensions -> Apps Script`.
3. Salin isi `Code.gs` ke editor Apps Script.
4. Simpan project.
5. Jalankan fungsi `setupSheets()` sekali dari editor untuk membuat sheet
   `licenses`, `logs`, `audit_logs`, `feedback`, dan `admin_pin_resets`.
6. Jika script tidak dibuat langsung dari spreadsheet, buka `Project Settings -> Script Properties`, lalu tambahkan:

```text
SPREADSHEET_ID=ID_SPREADSHEET_ANDA
API_SECRET=secret-acak-yang-sama-dengan-vercel
```

`API_SECRET` wajib ada. Vercel proxy akan mengirim field `secret_key` otomatis memakai env `GAS_API_SECRET`.

## Deploy Web App

1. Klik `Deploy -> New deployment`.
2. Pilih type `Web app`.
3. Execute as: `Me`.
4. Who has access: `Anyone with link`.
5. Klik `Deploy`.
6. Salin URL Web App ke Vercel env `GAS_API_URL`.

## Contoh Request

Semua request memakai POST dengan body JSON.

```bash
curl -X POST "https://script.google.com/macros/s/xxxxx/exec" \
  -H "Content-Type: text/plain" \
  -d '{"action":"list_licenses","secret_key":"secret-acak-yang-sama-dengan-frontend"}'
```

Untuk dashboard admin, gunakan satu snapshot agar tidak perlu memanggil
`list_licenses`, `list_feedback`, dan `list_logs` terpisah:

```bash
curl -X POST "https://script.google.com/macros/s/xxxxx/exec" \
  -H "Content-Type: text/plain" \
  -d '{"action":"dashboard_snapshot","secret_key":"secret-acak-yang-sama-dengan-frontend"}'
```

```bash
curl -X POST "https://script.google.com/macros/s/xxxxx/exec" \
  -H "Content-Type: text/plain" \
  -d '{"action":"register_clinic","secret_key":"secret-acak-yang-sama-dengan-frontend","clinic_name":"Klinik Bekam Sehat","clinic_phone":"08123456789"}'
```

```bash
curl -X POST "https://script.google.com/macros/s/xxxxx/exec" \
  -H "Content-Type: text/plain" \
  -d '{"action":"verify_license","secret_key":"secret-acak-yang-sama-dengan-frontend","clinic_id":"CLN-12345678","license_key":"BKM-XXXX-XXXX-XXXX-XXXX-XXXX","device_id":"DEVICE-001"}'
```

```bash
curl -X POST "https://script.google.com/macros/s/xxxxx/exec" \
  -H "Content-Type: text/plain" \
  -d '{"action":"update_license","secret_key":"secret-acak-yang-sama-dengan-frontend","license_key":"BKM-XXXX-XXXX-XXXX-XXXX-XXXX","status":"active","expired_at":"2027-05-02"}'
```

## Format Response

Semua response memakai struktur kompatibel berikut. Field `ok` dan `success`
selalu dikirim dan selalu bernilai sama. Untuk `verify_license`, nilainya
mengikuti validitas lisensi; untuk action admin, `true` berarti request berhasil
diproses.

```json
{
  "ok": true,
  "success": true,
  "message": "Request berhasil.",
  "data": {}
}
```

`dashboard_snapshot` mengembalikan:

```json
{
  "ok": true,
  "success": true,
  "message": "Snapshot dashboard berhasil diambil.",
  "data": {
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
  },
  "meta": {
    "licenses": { "limit": 50, "offset": 0, "total": 1000 },
    "feedback": { "limit": 50, "offset": 0, "total": 12 },
    "logs": { "limit": 50, "offset": 0, "total": 50 }
  }
}
```

`verify_license` tetap mengembalikan kontrak publik yang dipakai aplikasi desktop:

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

Response `verify_license` yang tidak valid tetap JSON normal, tetapi `ok` dan
`success` bernilai `false`:

```json
{
  "ok": false,
  "success": false,
  "valid": false,
  "error": "License sudah expired.",
  "message": "License sudah expired.",
  "data": {
    "valid": false,
    "reason": "expired",
    "status": "expired"
  }
}
```

Jika lisensi sudah terikat device, `device_id` wajib dikirim pada setiap
`verify_license`. Request tanpa `device_id` ditolak dengan reason
`device_id_required`.

Action list yang dipakai dashboard (`list_licenses`, `list_feedback`,
`list_logs`, dan `list_admin_pin_reset_requests`) mengembalikan `data` sebagai
array langsung plus `meta` pagination. Action `dashboard_snapshot` mengembalikan
`data.summary`, `data.licenses`, `data.feedback`, dan `data.logs` dalam satu
request.

Verifikasi valid yang masih dalam jendela throttle 6 jam tidak menambah baris
`logs`, `audit_logs`, atau memperbarui `last_checked_at`. Verifikasi invalid,
license tidak ditemukan, dan binding device baru tetap dicatat.
