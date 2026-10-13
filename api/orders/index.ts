import type { VercelRequest, VercelResponse } from "@vercel/node"
import { authorize, sql, toOrder } from "../_lib/shared.js"

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store")
  if (!authorize(req, res)) return

  try {
    // GET /api/orders → pesanan hari operasional ini
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

    // POST /api/orders → simpan pesanan baru
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
