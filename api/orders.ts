import { neon } from "@neondatabase/serverless"
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { timingSafeEqual } from "node:crypto"

// Satu file untuk semua endpoint pesanan (tanpa impor antar file, supaya
// Vercel tidak gagal melacak dependensi):
//   GET    /api/orders        → pesanan hari operasional ini
//   POST   /api/orders        → simpan pesanan baru
//   PATCH  /api/orders/:uid   → ubah status      (di-rewrite lewat vercel.json)
//   DELETE /api/orders/:uid   → hapus pesanan    (di-rewrite lewat vercel.json)

// DATABASE_URL diisi otomatis oleh integrasi Neon di Vercel.
const sql = neon(process.env.DATABASE_URL as string)

type OrderStatus = "Menunggu" | "Diproses" | "Diantar"
const STATUSES: OrderStatus[] = ["Menunggu", "Diproses", "Diantar"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Jakarta",
})

function formatTime(value: unknown): string {
  if (!value) return ""
  return timeFormat.format(new Date(value as string | Date))
}

// Bentuk yang dikirim ke browser (sama dengan tipe Order di App.tsx)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toOrder(row: Record<string, any>) {
  return {
    uid: String(row.uid),
    id: `JSL-${String(row.daily_no).padStart(3, "0")}`,
    customer: String(row.customer),
    table: String(row.table_code),
    items: String(row.items),
    note: String(row.note ?? ""),
    orderedAt: formatTime(row.created_at),
    deliveredAt: formatTime(row.delivered_at),
    status: row.status as OrderStatus,
  }
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

// Semua endpoint dilindungi kode akses sederhana (env APP_PIN).
function authorize(req: VercelRequest, res: VercelResponse): boolean {
  const expected = process.env.APP_PIN
  if (!expected) {
    res.status(500).json({ error: "APP_PIN belum diatur di server." })
    return false
  }
  const provided = Buffer.from(String(req.headers["x-app-pin"] ?? ""))
  const wanted = Buffer.from(expected)
  const ok =
    provided.length === wanted.length && timingSafeEqual(provided, wanted)
  if (!ok) {
    res.status(401).json({ error: "Kode akses salah." })
    return false
  }
  return true
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store")
  if (!authorize(req, res)) return

  try {
    const rawUid = req.query.uid
    const uid = Array.isArray(rawUid) ? rawUid[0] : rawUid

    // ---- Operasi pada satu pesanan: /api/orders/:uid ---------------------
    if (uid !== undefined) {
      if (!UUID.test(uid)) {
        return res.status(400).json({ error: "ID pesanan tidak valid." })
      }

      if (req.method === "PATCH") {
        const status = req.body?.status as OrderStatus
        if (!STATUSES.includes(status)) {
          return res.status(400).json({ error: "Status tidak valid." })
        }
        // Jam diantar dicatat oleh server saat status menjadi "Diantar".
        const rows = await sql`
          UPDATE orders
          SET status = ${status}::text,
              delivered_at = CASE
                WHEN ${status}::text = 'Diantar' THEN COALESCE(delivered_at, now())
                ELSE NULL
              END
          WHERE uid = ${uid}::uuid
          RETURNING uid, daily_no, customer, table_code, items, note, status,
                    created_at, delivered_at`
        if (rows.length === 0) {
          return res.status(404).json({ error: "Pesanan tidak ditemukan." })
        }
        return res.status(200).json(toOrder(rows[0]))
      }

      if (req.method === "DELETE") {
        const rows = await sql`
          DELETE FROM orders WHERE uid = ${uid}::uuid RETURNING uid`
        if (rows.length === 0) {
          return res.status(404).json({ error: "Pesanan tidak ditemukan." })
        }
        return res.status(200).json({ ok: true })
      }

      res.setHeader("Allow", "PATCH, DELETE")
      return res.status(405).json({ error: "Method tidak didukung." })
    }

    // ---- Koleksi pesanan: /api/orders ------------------------------------
    if (req.method === "GET") {
      const [days, rows] = await Promise.all([
        sql`SELECT jsl_business_date(now())::text AS d`,
        sql`
          SELECT uid, daily_no, customer, table_code, items, note, status,
                 created_at, delivered_at
          FROM orders
          WHERE business_date = jsl_business_date(now())
          ORDER BY daily_no DESC`,
      ])
      return res.status(200).json({ date: days[0].d, orders: rows.map(toOrder) })
    }

    if (req.method === "POST") {
      const customer = text(req.body?.customer, 100)
      const table = text(req.body?.table, 20).toUpperCase()
      const items = text(req.body?.items, 1000)
      const note = text(req.body?.note, 500)
      if (!customer || !table || !items) {
        return res
          .status(400)
          .json({ error: "Nama, meja, dan pesanan wajib diisi." })
      }

      const days = await sql`SELECT jsl_business_date(now())::text AS d`
      const day = days[0].d as string

      // Nomor urut per hari, atomik: dua komputer tidak akan dapat nomor sama.
      const counter = await sql`
        INSERT INTO daily_counters (business_date, last_no)
        VALUES (${day}::date, 1)
        ON CONFLICT (business_date)
        DO UPDATE SET last_no = daily_counters.last_no + 1
        RETURNING last_no`

      const inserted = await sql`
        INSERT INTO orders (business_date, daily_no, customer, table_code, items, note)
        VALUES (${day}::date, ${counter[0].last_no}, ${customer}, ${table}, ${items}, ${note})
        RETURNING uid, daily_no, customer, table_code, items, note, status,
                  created_at, delivered_at`
      return res.status(201).json(toOrder(inserted[0]))
    }

    res.setHeader("Allow", "GET, POST")
    return res.status(405).json({ error: "Method tidak didukung." })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: "Kesalahan server." })
  }
}
