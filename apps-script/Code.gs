const SHEET_NAME = "Orders"
// Pesanan sebelum jam ini dihitung ke hari operasional sebelumnya
// (supaya pesanan lewat tengah malam tetap masuk closing yang sama).
const BUSINESS_DAY_START_HOUR = 6

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  if (params.action) return handleApiRequest_(params);
  return HtmlService.createTemplateFromFile("index")
    .evaluate()
    .setTitle("Jogja Sky Lounge — Taking Order")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
}

function handleApiRequest_(params) {
  const callback = String(params.callback || "");
  if (!/^__[A-Za-z0-9_$]+$/.test(callback)) {
    return ContentService.createTextOutput("Invalid callback")
      .setMimeType(ContentService.MimeType.TEXT);
  }
  let result;
  try {
    const payload = params.payload ? JSON.parse(params.payload) : undefined;
    switch (params.action) {
      case "getOrders": result = getOrders(); break;
      case "saveOrder": result = saveOrder(payload); break;
      case "updateOrderStatus": result = updateOrderStatus(payload); break;
      case "deleteOrder": result = deleteOrder(payload); break;
      default: throw new Error("Unknown action");
    }
  } catch (error) {
    result = { error: String(error && error.message || error) };
  }
  return ContentService.createTextOutput(callback + "(" + JSON.stringify(result) + ");")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function saveOrder(order) {
  return withLock_(function () {
    const sheet = getOrderSheet_()
    sheet.appendRow([
      new Date(),
      order.id,
      order.customer,
      order.table,
      order.items,
      order.note || "",
      order.orderedAt,
      order.deliveredAt || "",
      order.status,
    ])
    return { ok: true, id: order.id }
  })
}

// Mengembalikan hanya pesanan pada hari operasional ini.
// Semua nilai dikirim sebagai string/objek biasa: google.script.run
// gagal (hasil null) jika ada objek Date di dalam hasilnya.
function getOrders() {
  const tz = Session.getScriptTimeZone()
  const today = businessDate_(new Date(), tz)
  const rows = getOrderSheet_().getDataRange().getValues()
  const orders = []
  for (let index = rows.length - 1; index >= 1; index -= 1) {
    const row = rows[index]
    if (!(row[0] instanceof Date)) continue
    if (businessDate_(row[0], tz) !== today) continue
    orders.push({
      id: String(row[1]),
      customer: String(row[2]),
      table: String(row[3]),
      items: String(row[4]),
      note: String(row[5] || ""),
      orderedAt: timeText_(row[6], tz),
      deliveredAt: timeText_(row[7], tz),
      status: String(row[8]),
    })
  }
  return { date: today, orders: orders }
}

function updateOrderStatus(order) {
  return withLock_(function () {
    const sheet = getOrderSheet_()
    const rows = sheet.getDataRange().getValues()
    // Dicari dari bawah: ID bisa berulang di hari berbeda, yang terbaru dipakai.
    for (let index = rows.length - 1; index >= 1; index -= 1) {
      if (String(rows[index][1]) === String(order.id)) {
        sheet
          .getRange(index + 1, 8, 1, 2)
          .setValues([[order.deliveredAt || "", order.status]])
        return { ok: true, id: order.id }
      }
    }
    return { ok: false, id: order.id }
  })
}

function deleteOrder(orderId) {
  return withLock_(function () {
    const sheet = getOrderSheet_()
    const rows = sheet.getDataRange().getValues()
    for (let index = rows.length - 1; index >= 1; index -= 1) {
      if (String(rows[index][1]) === String(orderId)) {
        sheet.deleteRow(index + 1)
        return { ok: true, id: orderId }
      }
    }
    return { ok: false, id: orderId }
  })
}

// Jalankan sekali secara manual jika sheet "Orders" sudah ada sebelumnya.
function setupSheet() {
  const sheet = getOrderSheet_()
  sheet.getRange("G:H").setNumberFormat("@")
}

function getOrderSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  let sheet = spreadsheet.getSheetByName(SHEET_NAME)
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME)
    sheet.appendRow([
      "Timestamp",
      "Order ID",
      "Customer",
      "Table",
      "Items",
      "Note",
      "Ordered At",
      "Delivered At",
      "Status",
    ])
    sheet.setFrozenRows(1)
    // Jam disimpan sebagai teks agar "19:42" tidak diubah menjadi objek waktu.
    sheet.getRange("G:H").setNumberFormat("@")
  }
  return sheet
}

function withLock_(fn) {
  const lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    return fn()
  } finally {
    lock.releaseLock()
  }
}

function businessDate_(date, tz) {
  const shifted = new Date(date.getTime() - BUSINESS_DAY_START_HOUR * 3600 * 1000)
  return Utilities.formatDate(shifted, tz, "yyyy-MM-dd")
}

function timeText_(value, tz) {
  if (value instanceof Date) return Utilities.formatDate(value, tz, "HH:mm")
  return value === null || value === undefined ? "" : String(value)
}
