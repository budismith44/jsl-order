-- Jalankan sekali di Neon SQL Editor (Vercel → Storage → Neon → Open in Neon).

-- Hari operasional: pesanan sebelum jam 06:00 WIB dihitung ke hari sebelumnya,
-- supaya pesanan lewat tengah malam tetap masuk closing malam yang sama.
-- Ubah '6 hours' dan 'Asia/Jakarta' di sini jika jam tutup outlet berbeda.
CREATE OR REPLACE FUNCTION jsl_business_date(ts timestamptz) RETURNS date AS $$
  SELECT ((ts AT TIME ZONE 'Asia/Jakarta') - interval '6 hours')::date
$$ LANGUAGE sql STABLE;

CREATE TABLE IF NOT EXISTS orders (
  uid           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date date        NOT NULL,
  daily_no      integer     NOT NULL,
  customer      text        NOT NULL,
  table_code    text        NOT NULL,
  items         text        NOT NULL,
  note          text        NOT NULL DEFAULT '',
  status        text        NOT NULL DEFAULT 'Menunggu'
                CHECK (status IN ('Menunggu', 'Diproses', 'Diantar')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz,
  UNIQUE (business_date, daily_no)
);

-- Penghitung nomor pesanan per hari (JSL-001, JSL-002, ...).
-- Diisi lewat satu perintah atomik, jadi dua komputer tidak bisa mendapat nomor kembar.
CREATE TABLE IF NOT EXISTS daily_counters (
  business_date date PRIMARY KEY,
  last_no       integer NOT NULL
);
