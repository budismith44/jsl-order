import type { VercelRequest, VercelResponse } from "@vercel/node"
import { STATUSES, authorize, sql, toOrder } from "../_lib/shared.js"
import type { OrderStatus } from "../_lib/shared.js"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store")
  if (!authorize(req, res)) return

  const uid = String(req.query.uid ?? "")
  if (!UUID.test(uid)) {
    return res.status(400).json({ error: "ID pesanan tidak valid." })
  }

  try {
    // PATCH /api/orders/:uid  body: { status }
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

    // DELETE /api/orders/:uid
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
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: "Kesalahan server." })
  }
}
