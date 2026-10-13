import { neon } from "@neondatabase/serverless"
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { timingSafeEqual } from "node:crypto"

// DATABASE_URL diisi otomatis oleh integrasi Neon di Vercel.
export const sql = neon(process.env.DATABASE_URL as string)

export type OrderStatus = "Menunggu" | "Diproses" | "Diantar"

export const STATUSES: OrderStatus[] = ["Menunggu", "Diproses", "Diantar"]

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
export function toOrder(row: Record<string, any>) {
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

// Semua endpoint dilindungi kode akses sederhana (env APP_PIN).
export function authorize(req: VercelRequest, res: VercelResponse): boolean {
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
