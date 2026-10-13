import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FormEvent, ReactNode } from "react"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

type OrderStatus = "Menunggu" | "Diproses" | "Diantar"

type Order = {
  uid: string // ID unik di database (dipakai untuk update / hapus)
  id: string // nomor tampilan, mis. JSL-027 (urut per hari)
  customer: string
  table: string
  items: string
  note: string
  orderedAt: string
  deliveredAt: string
  status: OrderStatus
}

type IconName = "bell" | "check" | "clock" | "dashboard" | "download" | "list" | "minus" | "plus" | "printer" | "search" | "settings" | "trash" | "utensils"

// Harus sama dengan fungsi jsl_business_date di schema.sql
const BUSINESS_DAY_START_HOUR = 6
const REFRESH_INTERVAL_MS = 20000
const PIN_KEY = "jsl-access-code"

const menuSuggestions = [
  "Nasi Goreng Kampung",
  "Grilled Salmon",
  "Jogja Club Sandwich",
  "Iced Lemon Tea",
  "Cappuccino",
]

function Icon({
  name,
  className = "size-5",
}: {
  name: IconName
  className?: string
}) {
  const paths: Record<IconName, ReactNode> = {
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12M7 10l5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
    list: (
      <>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </>
    ),
    minus: <path d="M5 12h14" />,
    plus: <path d="M12 5v14M5 12h14" />,
    printer: (
      <>
        <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="7" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63h.01A1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9v.01A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M8 6V3h8v3M19 6l-1 15H6L5 6" />
        <path d="M10 11v5M14 11v5" />
      </>
    ),
    utensils: (
      <>
        <path d="M3 2v7a3 3 0 0 0 3 3V2M9 2v7a3 3 0 0 1-3 3v10" />
        <path d="M16 2v20M16 2c3 0 5 3 5 7v3h-5" />
      </>
    ),
  }
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

function nowTime() {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date())
}

// Cadangan label tanggal sebelum data pertama dari server diterima
function localBusinessDate() {
  const shifted = new Date(Date.now() - BUSINESS_DAY_START_HOUR * 3600 * 1000)
  return [
    shifted.getFullYear(),
    String(shifted.getMonth() + 1).padStart(2, "0"),
    String(shifted.getDate()).padStart(2, "0"),
  ].join("-")
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number)
  return new Date(year, month - 1, day)
}

// ---- API (data disimpan di server, bukan di komputer) -------------------

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function getAccessCode() {
  try {
    return localStorage.getItem(PIN_KEY) ?? ""
  } catch {
    return ""
  }
}

function saveAccessCode(code: string) {
  try {
    localStorage.setItem(PIN_KEY, code)
  } catch {
    // abaikan jika storage tidak tersedia
  }
}

function clearAccessCode() {
  try {
    localStorage.removeItem(PIN_KEY)
  } catch {
    // abaikan jika storage tidak tersedia
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-app-pin": getAccessCode(),
    },
  })
  if (!response.ok) {
    let message = "Terjadi kesalahan pada server."
    try {
      const body = await response.json()
      if (body?.error) message = body.error
    } catch {
      // body bukan JSON
    }
    throw new ApiError(response.status, message)
  }
  return response.json() as Promise<T>
}

// ------------------------------------------------------------------------

export default function App() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [locked, setLocked] = useState(() => !getAccessCode())
  const [codeError, setCodeError] = useState(false)
  const [businessDate, setBusinessDate] = useState(localBusinessDate)
  const [customer, setCustomer] = useState("")
  const [table, setTable] = useState("")
  const [items, setItems] = useState([{ name: "", qty: 1 }])
  const [note, setNote] = useState("")
  const [search, setSearch] = useState("")
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null)
  const [toast, setToast] = useState("")

  // Naik setiap ada perubahan dari komputer ini; dipakai untuk membuang
  // hasil refresh yang sudah basi.
  const mutation = useRef(0)
  const loadedOnce = useRef(false)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(""), 2800)
    return () => window.clearTimeout(timer)
  }, [toast])

  const loadOrders = useCallback(async () => {
    if (locked) return
    const startedAt = mutation.current
    try {
      const result = await api<{ date: string; orders: Order[] }>("/api/orders")
      if (startedAt !== mutation.current) return
      setOrders(result.orders)
      setBusinessDate(result.date)
      loadedOnce.current = true
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearAccessCode()
        setCodeError(true)
        setLocked(true)
        return
      }
      if (!loadedOnce.current) setToast("Gagal memuat pesanan dari server.")
    } finally {
      setLoading(false)
    }
  }, [locked])

  useEffect(() => {
    if (locked) return
    loadOrders()
    const timer = window.setInterval(() => {
      if (!window.document.hidden) loadOrders()
    }, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [locked, loadOrders])

  function handleError(error: unknown, fallback: string) {
    if (error instanceof ApiError && error.status === 401) {
      clearAccessCode()
      setCodeError(true)
      setLocked(true)
      return
    }
    setToast(error instanceof ApiError ? error.message : fallback)
  }

  const filteredOrders = useMemo(
    () =>
      orders.filter((order) =>
        `${order.customer} ${order.table} ${order.items}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [orders, search],
  )

  const activeCount = orders.filter(
    (order) => order.status !== "Diantar",
  ).length
  const deliveredCount = orders.filter(
    (order) => order.status === "Diantar",
  ).length

  function updateItem(
    index: number,
    field: "name" | "qty",
    value: string | number,
  ) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    )
  }

  async function submitOrder(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const validItems = items.filter((item) => item.name.trim())
    if (!customer.trim() || !table.trim() || validItems.length === 0) {
      setToast("Lengkapi nama, meja, dan minimal satu pesanan.")
      return
    }
    setSaving(true)
    try {
      // Nomor pesanan dan jam pesan dibuat oleh server.
      const order = await api<Order>("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          customer: customer.trim(),
          table: table.trim().toUpperCase(),
          items: validItems.map((item) => `${item.qty}× ${item.name}`).join(", "),
          note: note.trim(),
        }),
      })
      mutation.current += 1
      setOrders((current) => [
        order,
        ...current.filter((existing) => existing.uid !== order.uid),
      ])
      setCustomer("")
      setTable("")
      setItems([{ name: "", qty: 1 }])
      setNote("")
      forwardToWindowsPrint(order)
    } catch (error) {
      // Form tidak dikosongkan agar bisa dicoba lagi.
      handleError(error, "Gagal menyimpan pesanan. Coba lagi.")
    } finally {
      setSaving(false)
    }
  }

  async function markDelivered(uid: string) {
    try {
      const updated = await api<Order>(`/api/orders/${uid}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "Diantar" }),
      })
      mutation.current += 1
      setOrders((current) =>
        current.map((order) => (order.uid === updated.uid ? updated : order)),
      )
      setToast("Pesanan ditandai sudah diantar.")
    } catch (error) {
      handleError(error, "Gagal memperbarui status pesanan.")
    }
  }

  async function deleteOrder() {
    if (!orderToDelete) return
    const target = orderToDelete
    try {
      await api(`/api/orders/${target.uid}`, { method: "DELETE" })
      mutation.current += 1
      setOrders((current) =>
        current.filter((order) => order.uid !== target.uid),
      )
      setToast(`Pesanan ${target.id} berhasil dihapus.`)
      setOrderToDelete(null)
    } catch (error) {
      handleError(error, "Gagal menghapus pesanan.")
    }
  }

  function exportHistoryToPdf() {
    if (orders.length === 0) {
      setToast("Belum ada history pesanan untuk diexport.")
      return
    }

    setToast("Menyiapkan laporan PDF...")
    const dateLabel = new Intl.DateTimeFormat("id-ID", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(dateFromKey(businessDate))
    const delivered = orders.filter(
      (order) => order.status === "Diantar",
    ).length
    const pdf = new jsPDF({ orientation: "landscape", format: "a4" })

    pdf.setFillColor(23, 32, 29)
    pdf.rect(0, 0, 297, 34, "F")
    pdf.setTextColor(255, 255, 255)
    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(18)
    pdf.text("JOGJA SKY LOUNGE", 14, 15)
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(9)
    pdf.text("THE JOGJA HOTEL  |  LAPORAN CLOSING HARIAN", 14, 23)
    pdf.text(dateLabel, 283, 15, { align: "right" })
    pdf.text(`Dicetak ${nowTime()} WIB`, 283, 23, { align: "right" })

    pdf.setTextColor(23, 32, 29)
    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(10)
    pdf.text(`Total pesanan: ${orders.length}`, 14, 44)
    pdf.text(`Sudah diantar: ${delivered}`, 67, 44)
    pdf.text(`Belum selesai: ${orders.length - delivered}`, 125, 44)

    // Urut dari pesanan paling awal agar mudah dicocokkan dengan nota
    const chronological = [...orders].reverse()

    autoTable(pdf, {
      startY: 51,
      head: [
        [
          "No.",
          "ID",
          "Customer",
          "Meja",
          "Pesanan",
          "Catatan",
          "Dipesan",
          "Diantar",
          "Status",
        ],
      ],
      body: chronological.map((order, index) => [
        index + 1,
        order.id,
        order.customer,
        order.table,
        order.items,
        order.note || "-",
        order.orderedAt,
        order.deliveredAt || "-",
        order.status,
      ]),
      styles: {
        font: "helvetica",
        fontSize: 7.5,
        cellPadding: 2.5,
        textColor: [23, 32, 29],
        lineColor: [232, 232, 227],
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [217, 168, 64],
        textColor: [23, 32, 29],
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: [246, 245, 241] },
      columnStyles: {
        0: { cellWidth: 10 },
        1: { cellWidth: 19 },
        3: { cellWidth: 16 },
        6: { cellWidth: 16 },
        7: { cellWidth: 16 },
        8: { cellWidth: 18 },
      },
      margin: { left: 14, right: 14 },
    })

    const pageCount = pdf.getNumberOfPages()
    for (let page = 1; page <= pageCount; page += 1) {
      pdf.setPage(page)
      pdf.setFontSize(8)
      pdf.setTextColor(122, 129, 126)
      pdf.text(
        `Jogja Sky Lounge · Halaman ${page} dari ${pageCount}`,
        283,
        202,
        { align: "right" },
      )
    }

    pdf.save(`closing-jogja-sky-lounge-${businessDate}.pdf`)
    setToast("Laporan PDF berhasil diunduh.")
  }

  function printOrder(order: Order) {
    forwardToWindowsPrint(order)
  }

  function forwardToWindowsPrint(order: Order) {
    setSelectedOrder(order)
    setToast(`Menyiapkan job cetak ${order.id}...`)

    // Tunggu struk selesai dirender sebelum membuka dialog native browser.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.print()
        setToast("Job cetak diteruskan ke sistem Windows.")
      })
    })
  }

  if (locked) {
    return (
      <AccessScreen
        error={codeError}
        onSubmit={(code) => {
          saveAccessCode(code)
          setCodeError(false)
          setLoading(true)
          setLocked(false)
        }}
      />
    )
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 flex-col bg-sidebar text-white lg:flex print:hidden">
          <div className="flex h-24 items-center gap-3 border-b border-white/10 px-7">
            <div className="flex size-11 items-center justify-center rounded-xl bg-brand text-lg font-bold text-sidebar">
              JS
            </div>
            <div>
              <p className="font-display text-lg font-semibold leading-tight">
                Jogja Sky
              </p>
              <p className="text-xs tracking-widest text-white/50">LOUNGE</p>
            </div>
          </div>
          <nav className="flex-1 space-y-2 px-4 py-7">
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-widest text-white/35">
              Operasional
            </p>
            <button className="nav-item nav-item-active">
              <Icon name="dashboard" /> Dashboard
            </button>
            <button className="nav-item">
              <Icon name="plus" /> Pesanan Baru
            </button>
            <button className="nav-item">
              <Icon name="list" /> Riwayat Pesanan
            </button>
            <p className="mb-3 mt-9 px-3 text-xs font-semibold uppercase tracking-widest text-white/35">
              Sistem
            </p>
            <button className="nav-item">
              <Icon name="printer" /> Riwayat Cetak
            </button>
            <button className="nav-item">
              <Icon name="settings" /> Pengaturan
            </button>
          </nav>
          <div className="m-4 rounded-2xl bg-white/6 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <span className="size-2 rounded-full bg-success ring-4 ring-success/15" />
              Print via Windows
            </div>
            <p className="text-xs leading-relaxed text-white/45">
              Printer dipilih melalui dialog sistem
            </p>
          </div>
        </aside>

        <main className="min-w-0 flex-1 print:hidden">
          <header className="flex min-h-24 items-center justify-between border-b border-line bg-white px-5 md:px-8 xl:px-10">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-brand-dark">
                The Jogja Hotel
              </p>
              <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
                Taking Order
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden text-right md:block">
                <p className="text-sm font-semibold">Selamat malam</p>
                <p className="text-xs text-muted">
                  {new Intl.DateTimeFormat("id-ID", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }).format(new Date())}
                </p>
              </div>
              <button className="icon-button" aria-label="Notifikasi">
                <Icon name="bell" />
              </button>
            </div>
          </header>

          <div className="mx-auto max-w-screen-2xl p-5 md:p-8 xl:p-10">
            <section className="mb-7 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
              <Stat label="Pesanan aktif" value={activeCount} accent="brand" />
              <Stat
                label="Sudah diantar"
                value={deliveredCount}
                accent="success"
              />
              <Stat label="Total hari ini" value={orders.length} accent="ink" />
              <div className="col-span-2 flex items-center justify-between rounded-2xl border border-line bg-white p-5 shadow-soft md:col-span-1">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Waktu saat ini
                  </p>
                  <p className="mt-2 font-display text-2xl font-semibold">
                    {nowTime()} WIB
                  </p>
                </div>
                <div className="icon-tile">
                  <Icon name="clock" />
                </div>
              </div>
            </section>

            <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <section className="overflow-hidden rounded-3xl border border-line bg-white shadow-soft">
                <div className="flex items-center gap-4 border-b border-line px-6 py-5 md:px-7">
                  <div className="icon-tile bg-brand-soft text-brand-dark">
                    <Icon name="utensils" />
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-semibold">
                      Catat pesanan baru
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      Masukkan detail pesanan customer.
                    </p>
                  </div>
                </div>
                <form className="space-y-5 p-6 md:p-7" onSubmit={submitOrder}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Nama customer" required>
                      <input
                        className="input"
                        value={customer}
                        onChange={(e) => setCustomer(e.target.value)}
                        placeholder="Contoh: Bapak Andri"
                      />
                    </Field>
                    <Field label="Nomor / kode meja" required>
                      <input
                        className="input"
                        value={table}
                        onChange={(e) => setTable(e.target.value)}
                        placeholder="Contoh: A-12"
                      />
                    </Field>
                  </div>
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label className="label">
                        Pesanan <span className="text-danger">*</span>
                      </label>
                      <span className="text-xs text-muted">
                        {items.length} item
                      </span>
                    </div>
                    <div className="space-y-3">
                      {items.map((item, index) => (
                        <div className="flex gap-2" key={index}>
                          <div className="flex h-12 shrink-0 items-center rounded-xl border border-line bg-canvas">
                            <button
                              type="button"
                              className="qty-button"
                              aria-label="Kurangi jumlah"
                              onClick={() =>
                                updateItem(
                                  index,
                                  "qty",
                                  Math.max(1, item.qty - 1),
                                )
                              }
                            >
                              <Icon name="minus" className="size-4" />
                            </button>
                            <span className="w-7 text-center text-sm font-bold">
                              {item.qty}
                            </span>
                            <button
                              type="button"
                              className="qty-button"
                              aria-label="Tambah jumlah"
                              onClick={() =>
                                updateItem(index, "qty", item.qty + 1)
                              }
                            >
                              <Icon name="plus" className="size-4" />
                            </button>
                          </div>
                          <input
                            className="input min-w-0 flex-1"
                            list="menu-items"
                            value={item.name}
                            onChange={(e) =>
                              updateItem(index, "name", e.target.value)
                            }
                            placeholder="Nama menu / minuman"
                          />
                          {items.length > 1 && (
                            <button
                              type="button"
                              className="icon-button shrink-0 text-muted hover:text-danger"
                              aria-label="Hapus item"
                              onClick={() =>
                                setItems((current) =>
                                  current.filter(
                                    (_, itemIndex) => itemIndex !== index,
                                  ),
                                )
                              }
                            >
                              <Icon name="minus" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <datalist id="menu-items">
                      {menuSuggestions.map((item) => (
                        <option value={item} key={item} />
                      ))}
                    </datalist>
                    <button
                      type="button"
                      className="mt-3 flex items-center gap-2 text-sm font-bold text-brand-dark transition hover:text-brand-deep"
                      onClick={() =>
                        setItems((current) => [
                          ...current,
                          { name: "", qty: 1 },
                        ])
                      }
                    >
                      <span className="flex size-6 items-center justify-center rounded-full bg-brand-soft">
                        <Icon name="plus" className="size-4" />
                      </span>{" "}
                      Tambah item lain
                    </button>
                  </div>
                  <Field label="Catatan / request khusus" optional>
                    <textarea
                      className="input min-h-24 resize-none py-3"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Contoh: tidak pedas, saus dipisah, alergi kacang..."
                    />
                  </Field>
                  <div className="flex items-center gap-3 rounded-xl bg-canvas p-4 text-sm text-muted">
                    <Icon name="clock" className="size-5 text-brand-dark" />
                    Jam pesanan akan tercatat otomatis saat disimpan.
                  </div>
                  <button
                    className="primary-button w-full disabled:opacity-60"
                    type="submit"
                    disabled={saving}
                  >
                    <Icon name="printer" />{" "}
                    {saving ? "Menyimpan..." : "Simpan & cetak pesanan"}
                  </button>
                  <p className="text-center text-xs leading-relaxed text-muted">
                    Setelah disimpan, job diteruskan ke dialog printer Windows.
                  </p>
                </form>
              </section>

              <section className="overflow-hidden rounded-3xl border border-line bg-white shadow-soft">
                <div className="border-b border-line px-6 py-5 md:px-7">
                  <div className="flex flex-col justify-between gap-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="font-display text-xl font-semibold">
                          Pesanan hari ini
                        </h2>
                        <p className="mt-1 text-sm text-muted">
                          Pantau dan perbarui status pesanan.
                        </p>
                      </div>
                      <button
                        className="export-button"
                        onClick={exportHistoryToPdf}
                      >
                        <Icon name="download" className="size-4" /> Export PDF
                      </button>
                    </div>
                    <div className="relative">
                      <Icon
                        name="search"
                        className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                      />
                      <input
                        className="input h-10 pl-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Cari pesanan..."
                      />
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-line">
                  {filteredOrders.map((order) => (
                    <article
                      className="p-5 transition hover:bg-canvas/60 md:p-6"
                      key={order.uid}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-sidebar font-display text-sm font-bold text-white">
                          {order.table}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="font-semibold">{order.customer}</p>
                              <p className="mt-0.5 text-xs text-muted">
                                {order.id} · Dipesan {order.orderedAt}
                              </p>
                            </div>
                            <StatusBadge status={order.status} />
                          </div>
                          <p className="mt-3 text-sm font-medium leading-relaxed">
                            {order.items}
                          </p>
                          {order.note && (
                            <p className="mt-2 rounded-lg bg-note px-3 py-2 text-xs leading-relaxed text-note-ink">
                              Catatan: {order.note}
                            </p>
                          )}
                          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                            <p className="text-xs text-muted">
                              {order.deliveredAt
                                ? `Diantar pukul ${order.deliveredAt}`
                                : "Belum diantar"}
                            </p>
                            <div className="flex gap-2">
                              <button
                                className="delete-button"
                                onClick={() => setOrderToDelete(order)}
                                aria-label={`Hapus pesanan ${order.id}`}
                                title="Hapus pesanan"
                              >
                                <Icon name="trash" className="size-4" />
                              </button>
                              <button
                                className="secondary-button"
                                onClick={() => printOrder(order)}
                              >
                                <Icon name="printer" className="size-4" /> Cetak
                              </button>
                              {order.status !== "Diantar" && (
                                <button
                                  className="success-button"
                                  onClick={() => markDelivered(order.uid)}
                                >
                                  <Icon name="check" className="size-4" /> Sudah
                                  diantar
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                  {loading && (
                    <div className="p-12 text-center text-sm text-muted">
                      Memuat pesanan dari server...
                    </div>
                  )}
                  {!loading && filteredOrders.length === 0 && (
                    <div className="p-12 text-center text-sm text-muted">
                      Pesanan tidak ditemukan.
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-sidebar px-5 py-3 text-sm font-semibold text-white shadow-toast print:hidden">
          {toast}
        </div>
      )}

      {orderToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-sidebar/55 p-5 backdrop-blur-sm print:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-order-title"
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-toast md:p-7">
            <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-danger/10 text-danger">
              <Icon name="trash" />
            </div>
            <h2
              className="font-display text-2xl font-semibold"
              id="delete-order-title"
            >
              Hapus pesanan?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Pesanan <strong className="text-ink">{orderToDelete.id}</strong>{" "}
              atas nama{" "}
              <strong className="text-ink">{orderToDelete.customer}</strong>{" "}
              akan dihapus dari history di server. Tindakan ini tidak dapat
              dibatalkan.
            </p>
            <div className="mt-7 flex justify-end gap-3">
              <button
                className="secondary-button h-11 px-5 text-sm"
                onClick={() => setOrderToDelete(null)}
              >
                Batal
              </button>
              <button className="danger-button" onClick={deleteOrder}>
                <Icon name="trash" className="size-4" /> Ya, hapus pesanan
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedOrder && (
        <section className="hidden print:block">
          <div className="receipt">
            <p className="receipt-title">JOGJA SKY LOUNGE</p>
            <p>THE JOGJA HOTEL</p>
            <p>--------------------------------</p>
            <p>
              {selectedOrder.id} · {selectedOrder.orderedAt}
            </p>
            <p>Customer : {selectedOrder.customer}</p>
            <p>Meja : {selectedOrder.table}</p>
            <p>--------------------------------</p>
            <p className="receipt-items">{selectedOrder.items}</p>
            {selectedOrder.note && <p>NOTE: {selectedOrder.note}</p>}
            <p>--------------------------------</p>
            <p>Status: {selectedOrder.status}</p>
            {selectedOrder.deliveredAt && (
              <p>Diantar: {selectedOrder.deliveredAt}</p>
            )}
            <p>--------------------------------</p>
            <p className="receipt-footer">Terima kasih</p>
          </div>
        </section>
      )}
    </div>
  )
}

function AccessScreen({
  error,
  onSubmit,
}: {
  error: boolean
  onSubmit: (code: string) => void
}) {
  const [value, setValue] = useState("")
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-5 text-ink">
      <form
        className="w-full max-w-sm space-y-5 rounded-3xl border border-line bg-white p-7 shadow-soft"
        onSubmit={(event) => {
          event.preventDefault()
          if (value.trim()) onSubmit(value.trim())
        }}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-dark">
            The Jogja Hotel
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold">
            Jogja Sky Lounge
          </h1>
          <p className="mt-1 text-sm text-muted">
            Masukkan kode akses untuk membuka aplikasi.
          </p>
        </div>
        <input
          className="input"
          type="password"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Kode akses"
        />
        {error && <p className="text-sm text-danger">Kode akses salah.</p>}
        <button className="primary-button w-full" type="submit">
          Masuk
        </button>
      </form>
    </div>
  )
}

function Field({
  label,
  required,
  optional,
  children,
}: {
  label: string
  required?: boolean
  optional?: boolean
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="label">
        {label} {required && <span className="text-danger">*</span>}{" "}
        {optional && <span className="font-normal text-muted">(opsional)</span>}
      </span>
      <span className="mt-2 block">{children}</span>
    </label>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent: "brand" | "success" | "ink"
}) {
  const accentClass =
    accent === "brand"
      ? "bg-brand"
      : accent === "success"
        ? "bg-success"
        : "bg-sidebar"
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-white p-5 shadow-soft">
      <span className={`absolute inset-y-0 left-0 w-1 ${accentClass}`} />
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="mt-2 font-display text-3xl font-semibold">
        {String(value).padStart(2, "0")}
      </p>
    </div>
  )
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const style =
    status === "Diantar"
      ? "bg-success-soft text-success-deep"
      : status === "Diproses"
        ? "bg-brand-soft text-brand-deep"
        : "bg-waiting-soft text-waiting"
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold ${style}`}>
      {status}
    </span>
  )
}
