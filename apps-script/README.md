# Google Apps Script bridge

`Code.gs` menyediakan penyimpanan bersama ke Google Sheets. Frontend yang
dideploy sebagai web app biasa menggunakan endpoint JSONP Apps Script; versi
yang di-host langsung oleh Apps Script tetap bisa memakai `google.script.run`.

### Menghubungkan deployment frontend ke Sheets

1. Buat atau buka project Apps Script dan salin isi `Code.gs` ke dalamnya.
2. Jalankan `setupSheet()` sekali jika ingin membuat/menyiapkan sheet
   `Orders`. Pastikan zona waktu project Apps Script sesuai lokasi operasional.
3. Deploy sebagai **Web app**, pilih **Execute as: Me**, dan atur akses sesuai
   kebijakan organisasi. Salin URL deployment yang berakhiran `/exec`.
4. Isi `VITE_GAS_API_URL` dengan URL tersebut di environment build hosting
   frontend, lalu build dan deploy ulang frontend. Jangan menambahkan endpoint
   ini di browser melalui local storage.

Semua komputer akan membaca serta menulis sheet yang sama. Aplikasi memuat
ulang pesanan setiap 30 detik. Endpoint Apps Script memberi akses tulis kepada
siapa pun yang dapat mengakses URL sesuai pengaturan deployment; batasi akses
deployment atau tambahkan autentikasi sebelum dipakai untuk data sensitif.
Jika URL backend tidak dikonfigurasi, aplikasi menampilkan pesan dan tidak
menyimpan order ke browser.

## Alur printing

Pencetakan mengikuti pola aplikasi Google Spreadsheet:

1. Frontend membuat versi struk yang hanya terlihat saat proses print.
2. Frontend memanggil API browser `window.print()`.
3. Browser meneruskan job ke dialog cetak native Windows.
4. Pemilihan printer, jumlah salinan, ukuran kertas, dan konfigurasi lainnya
   ditangani oleh browser serta Windows, bukan oleh Google Apps Script.

Dengan alur ini web app tidak membutuhkan akses langsung ke driver printer.
Browser memang tidak mengizinkan aplikasi web memilih printer atau mencetak
diam-diam. Print tanpa dialog hanya dimungkinkan dengan konfigurasi kiosk
printing atau local print bridge terpisah.
