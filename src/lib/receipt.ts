import { currencySymbol, formatAmount } from './format';
import { DEFAULT_PRINTER_SETTINGS, getPrinterSettings, printRaw } from './printer';
import type { PrinterSettings } from './printer';
import type { CartItem, Sale } from './db/types';
import { EscPosEncoder } from './escpos';

export const RESTAURANT = {
  name: 'ChefTech Restaurant',
  phone: '0300-0000000',
  addressLine1: '123 Main Street',
  addressLine2: 'Your City',
  address: '123 Main Street, Your City',
  accountTitle: 'Account Holder Name',
  accountMethod: 'Jazzcash/Easypaisa',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Formats a number as 2,000.00 (pure ASCII, always 2 decimals). */
export function formatDecimal(value: number): string {
  const num = Number(value) || 0;
  const [intPart, decPart] = Math.abs(num).toFixed(2).split('.');
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${num < 0 ? '-' : ''}${withCommas}.${decPart}`;
}

/** Formats timestamp as "05 Nov 2026 20:54" matching the thermal bill format. */
export function formatBillTimestamp(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value ?? '');
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const mon = MONTHS[d.getMonth()] || 'Jan';
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${day} ${mon} ${year} ${hours}:${mins}`;
}

/**
 * Renders the circular "CHEFTECH RESTAURANT" rooster stamp onto an offscreen
 * canvas and packs it into 1-bit monochrome ESC/POS raster bytes (168x120 px).
 * Returns null in non-browser environments (e.g., Node unit tests).
 */
/**
 * Renders the circular monochrome "CHEFTECH RESTAURANT" rooster stamp
 * onto a full-line-width offscreen canvas (560 dots = 70 bytes/row on 80mm;
 * 368 dots = 46 bytes/row on 58mm) with the stamp drawn at horizontal center (cx = width / 2).
 * Because many ESC/POS thermal printers ignore `ESC a 1` (center align) for `GS v 0` raster
 * graphics and always start at dot 0, padding the raster row symmetrically to the full printable
 * line width guarantees the logo prints dead-center on both printers that ignore `ESC a 1` and
 * printers that honor `ESC a 1`.
 */
export function buildLogoRaster(
  paperWidth: '58mm' | '80mm' = '80mm',
): { width: number; height: number; bytes: Uint8Array } | null {
  if (typeof document === 'undefined') return null;
  const width = paperWidth === '80mm' ? 560 : 368; // 70 bytes/row (80mm) or 46 bytes/row (58mm)
  const height = 120;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // White background across the full printable width
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#000000';
  const cx = width / 2;
  const cy = height / 2;

  // Outer & inner oval stamp rings
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 76, 54, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 71, 49, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Inner emblem oval around the rooster
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 46, 31, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Helper to draw curved text along an elliptical arc
  const drawArcText = (str: string, radiusX: number, radiusY: number, startAngle: number, endAngle: number, bottom = false) => {
    ctx.save();
    ctx.font = 'bold 10px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const count = str.length;
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const angle = startAngle + t * (endAngle - startAngle);
      const x = cx + radiusX * Math.cos(angle);
      const y = cy + radiusY * Math.sin(angle);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(bottom ? angle - Math.PI / 2 : angle + Math.PI / 2);
      ctx.fillText(str[i], 0, 0);
      ctx.restore();
    }
    ctx.restore();
  };

  drawArcText('CHEFTECH', 58, 40, -Math.PI * 0.82, -Math.PI * 0.18, false);
  drawArcText('RESTAURANT', 58, 40, Math.PI * 0.80, Math.PI * 0.20, true);

  // Left & right stars
  ctx.font = 'bold 11px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('★', cx - 58, cy + 1);
  ctx.fillText('★', cx + 58, cy + 1);

  // Center rooster silhouette (optically centered at cx - 3 since tail extends to +28 and beak to -22)
  ctx.save();
  ctx.translate(cx - 3, cy);
  ctx.beginPath();
  // Head & neck (left)
  ctx.moveTo(-18, -8);
  ctx.quadraticCurveTo(-15, -18, -8, -16);
  // Comb
  ctx.lineTo(-10, -21);
  ctx.lineTo(-5, -18);
  ctx.lineTo(-4, -22);
  ctx.lineTo(0, -17);
  // Back of neck down to breast/back
  ctx.quadraticCurveTo(-2, -6, 6, -4);
  // Tail feathers (right side)
  ctx.quadraticCurveTo(18, -20, 26, -12);
  ctx.quadraticCurveTo(18, -8, 14, -2);
  ctx.quadraticCurveTo(25, -10, 28, 0);
  ctx.quadraticCurveTo(19, -1, 14, 4);
  ctx.quadraticCurveTo(22, 2, 23, 10);
  // Belly & body
  ctx.quadraticCurveTo(10, 14, -4, 13);
  ctx.quadraticCurveTo(-16, 11, -15, 0);
  // Beak
  ctx.lineTo(-22, -5);
  ctx.lineTo(-17, -7);
  ctx.closePath();
  ctx.fill();

  // Legs
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-4, 12);
  ctx.lineTo(-6, 22);
  ctx.moveTo(3, 12);
  ctx.lineTo(4, 22);
  ctx.stroke();
  ctx.restore();

  const imgData = ctx.getImageData(0, 0, width, height).data;
  const bytesPerRow = width / 8;
  const packed = new Uint8Array(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luminance < 160) {
        packed[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return { width, height, bytes: packed };
}

/**
 * Encodes the sale into raw ESC/POS bytes matching the ChefTech Customer Copy layout.
 */
export function generateEscPosReceipt(sale: Sale, settings: PrinterSettings): Uint8Array {
  const encoder = new EscPosEncoder();
  encoder.initialize();

  const cols = settings.paperWidth === '80mm' ? 47 : 31;
  const dashCount = settings.paperWidth === '80mm' ? 24 : 16;
  const dashedRule = Array(dashCount).fill('-').join(' ');

  if (settings.printKitchenTicket) {
    encoder.align('center');
    encoder.bold(true);
    encoder.setSize(0, 1);
    encoder.text('KITCHEN ORDER');
    encoder.setSize(0, 0);
    encoder.bold(false);
    encoder.text(`Bill #CT-${sale.id}`);
    encoder.text(`By: ${sale.serverUser || 'Staff'}`);
    encoder.text(`Time: ${formatBillTimestamp(sale.timestamp)}`);
    encoder.text(`Type: ${sale.orderType}${sale.tableNumber ? ` (${sale.tableNumber})` : ''}`);
    encoder.text(dashedRule);
    encoder.align('left');
    for (const item of sale.items || []) {
      const modifiers = (item.modifiers || []).map((m) => m.name).join(', ');
      const name = modifiers ? `${item.name} (${modifiers})` : item.name;
      encoder.text(`${item.qty}x ${name}${item.note ? ` - ${item.note}` : ''}`);
    }
    encoder.text(dashedRule);
    encoder.feed(4);
    encoder.cut();
  }

  // 1. Top Circular Rooster Stamp Logo
  const logo = buildLogoRaster(settings.paperWidth);
  if (logo) {
    encoder.align('center');
    encoder.rasterImage(logo.width, logo.height, logo.bytes);
    encoder.text(' ');
  }

  // 2. Centered Double-Height "Customer Copy" & "ChefTech Restaurant"
  encoder.align('center');
  encoder.bold(false);
  encoder.setSize(0, 1);
  encoder.text('Customer Copy');
  encoder.text(settings.headerText || RESTAURANT.name);
  encoder.setSize(0, 0);

  // 3. Centered Address & Phone
  const addr1 = settings.businessAddressLine1 ?? RESTAURANT.addressLine1;
  const addr2 = settings.businessAddressLine2 ?? RESTAURANT.addressLine2;
  const phone = settings.businessPhone ?? RESTAURANT.phone;
  const payTitle = settings.paymentInfoTitle ?? RESTAURANT.accountTitle;
  const payDetails = settings.paymentInfoDetails ?? RESTAURANT.accountMethod;

  if (addr1) encoder.text(addr1);
  if (addr2) encoder.text(addr2);
  if (phone) encoder.text(phone);

  // 4. Bill #, Timestamp & Cashier
  encoder.align('left');
  encoder.text(dashedRule);
  if (settings.printOrderDetails) {
    const billNo = `Bill #CT-${sale.id ?? ''}`;
    const dateStr = formatBillTimestamp(sale.timestamp);
    const gap = Math.max(1, cols - billNo.length - dateStr.length);
    encoder.text(billNo + ' '.repeat(gap) + dateStr);
    const cashierLabel =
      sale.orderType === 'DINE_IN' && sale.tableNumber
        ? `Cashier: ${settings.headerText || RESTAURANT.name} (${sale.tableNumber})`
        : `Cashier: ${settings.headerText || RESTAURANT.name}`;
    encoder.text(cashierLabel);
    encoder.text(dashedRule);
  }

  // 5. Customer / Delivery Info (shown whenever customer name/address/phone is present)
  const cust = sale.deliveryInfo?.phone || sale.deliveryInfo?.name ? sale.deliveryInfo : sale.customer;
  if (settings.printDeliveryDetails && cust && (cust.name || cust.address || cust.phone)) {
    const custLabel = [cust.name, cust.address].filter(Boolean).join(' ').trim();
    if (custLabel) {
      encoder.text(`Customer: ${custLabel}`);
    }
    if (cust.phone) {
      encoder.text(`Phone: ${cust.phone}`);
    }
    encoder.text(dashedRule);
  }

  // 6. 4-Column Item Table: Item | Rate | Qty | Amount
  const itemW = settings.paperWidth === '80mm' ? 21 : 12;
  const rateW = settings.paperWidth === '80mm' ? 10 : 7;
  const qtyW = settings.paperWidth === '80mm' ? 5 : 4;
  const amtW = settings.paperWidth === '80mm' ? 11 : 8;

  const headerLine =
    'Item'.padEnd(itemW, ' ') +
    'Rate'.padStart(rateW, ' ') +
    'Qty'.padStart(qtyW, ' ') +
    'Amount'.padStart(amtW, ' ');
  encoder.text(headerLine);
  encoder.text(dashedRule);

  for (const item of sale.items || []) {
    const modifiers = (item.modifiers || []).map((m) => m.name).join(', ');
    const fullName = modifiers ? `${item.name} (${modifiers})` : item.name;
    const rateStr = formatDecimal(item.price);
    const qtyStr = String(item.qty);
    const amtStr = formatDecimal(item.price * item.qty);

    if (fullName.length <= itemW - 1) {
      const row =
        fullName.padEnd(itemW, ' ') +
        rateStr.padStart(rateW, ' ') +
        qtyStr.padStart(qtyW, ' ') +
        amtStr.padStart(amtW, ' ');
      encoder.text(row);
    } else {
      // First line has the first chunk of name + Rate + Qty + Amount; remaining name wraps below
      const firstChunk = fullName.slice(0, itemW - 1);
      const row =
        firstChunk.padEnd(itemW, ' ') +
        rateStr.padStart(rateW, ' ') +
        qtyStr.padStart(qtyW, ' ') +
        amtStr.padStart(amtW, ' ');
      encoder.text(row);
      let rest = fullName.slice(itemW - 1).trim();
      while (rest.length > 0) {
        encoder.text(rest.slice(0, cols));
        rest = rest.slice(cols).trim();
      }
    }
    if (item.note) {
      encoder.text(`  Note: ${item.note}`);
    }
  }

  encoder.text(dashedRule);

  // 7. Charges & Double-Height Total Amount
  if (settings.printTotals) {
    const extraRow = (label: string, amount: number, sign = '') => {
      if (!amount) return;
      const val = `${sign}${formatDecimal(amount)}`;
      const space = Math.max(1, cols - label.length - val.length);
      encoder.text(label + ' '.repeat(space) + val);
    };

    if (sale.discountAmount || sale.loyaltyDiscount || sale.deliveryCharge || sale.packingCharge || sale.taxAmount || sale.otherCharge) {
      extraRow('Subtotal', sale.subtotal);
      if (sale.discountAmount) extraRow(`Discount (${sale.discountPercent || 0}%)`, sale.discountAmount, '-');
      if (sale.loyaltyDiscount) extraRow('Loyalty Discount', sale.loyaltyDiscount, '-');
      extraRow('Delivery Charge', sale.deliveryCharge);
      extraRow('Packing Charge', sale.packingCharge);
      extraRow(`Tax (${sale.taxPercent || 0}%)`, sale.taxAmount);
      extraRow('Other Charges', sale.otherCharge);
    }

    const totalLabel = 'Total Amount';
    const totalVal = `${currencySymbol()}${formatDecimal(sale.total)}`;
    const padSpaces = Math.max(1, cols - totalLabel.length - totalVal.length);
    encoder.setSize(0, 0);
    encoder.rawText(totalLabel + ' '.repeat(padSpaces));
    encoder.setSize(0, 1);
    encoder.text(totalVal);
    encoder.setSize(0, 0);

    encoder.text(dashedRule);
    encoder.text(`Total Items:   ${(sale.items || []).length}`);
    encoder.text(dashedRule);
  }

  // 8. Footer Contact & Payment details
  if (settings.printFooter) {
    if (phone) {
      encoder.align('center');
      encoder.text(phone);
    }
    if (payTitle || payDetails) {
      encoder.align('left');
      if (payTitle) encoder.text(payTitle);
      if (payDetails) encoder.text(payDetails);
    }
    if (settings.footerText?.trim()) {
      encoder.align('center');
      encoder.text(settings.footerText.trim());
    }
  }

  encoder.feed(4);
  encoder.cut();
  return encoder.build();
}

/**
 * Prints to the paired thermal printer, else to the browser's print dialog
 * via a hidden iframe (the POS tab keeps its cart and open modals, unlike a
 * new window). Returns how the receipt was printed so the caller can warn
 * when the thermal printer was not used.
 */
export async function printReceipt(sale: Sale): Promise<'thermal' | 'browser'> {
  const settings = await getPrinterSettings();

  try {
    const bytes = generateEscPosReceipt(sale, settings);
    await printRaw(bytes);
    return 'thermal';
  } catch (e) {
    console.warn('Direct thermal print failed, falling back to browser print:', e);
  }

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);

  frame.srcdoc = receiptDocument(sale, settings);
  await new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    setTimeout(resolve, 2000);
  });

  const win = frame.contentWindow;
  if (!win) {
    frame.remove();
    throw new Error('Could not prepare the receipt for printing.');
  }
  const cleanUp = () => setTimeout(() => frame.remove(), 1000);
  win.addEventListener('afterprint', cleanUp, { once: true });
  win.focus();
  win.print();
  return 'browser';
}

/** Native share sheet on mobile, WhatsApp web otherwise. */
export async function shareReceipt(sale: Sale): Promise<void> {
  const text = receiptText(sale, await getPrinterSettings());
  if (navigator.share) {
    try {
      await navigator.share({ title: `Receipt #${sale.id}`, text });
      return;
    } catch {
      // The user dismissed the sheet, or the platform refused — fall through to WhatsApp.
    }
  }
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

/** Everything a thermal printer receives, kept as text so a share message is one line per item. */
export function receiptLines(sale: Sale, settings: PrinterSettings = DEFAULT_PRINTER_SETTINGS): string[] {
  const lines: string[] = [`Order #${sale.id}`, formatDate(sale.timestamp, settings.dateFormat)];
  lines.push(`Server: ${sale.serverUser || 'Staff'}`, `Type: ${sale.orderType}`);
  if (sale.orderType === 'DELIVERY' && sale.deliveryInfo) {
    lines.push(
      `Name: ${sale.deliveryInfo.name || '—'}`,
      `Phone: ${sale.deliveryInfo.phone || '—'}`,
      `Address: ${sale.deliveryInfo.address || '—'}`,
    );
  }
  for (const item of sale.items || []) {
    lines.push(`${item.name} x${item.qty}  ${formatAmount(item.price * item.qty)}`);
    if (item.refundedQty) lines.push(`  (refunded ${item.refundedQty})`);
  }
  const rows: [string, number][] = [
    ['Subtotal', sale.subtotal],
    ...(sale.discountAmount ? [[`Discount ${sale.discountPercent || 0}%`, -sale.discountAmount] as [string, number]] : []),
    ...(sale.loyaltyDiscount ? [['Loyalty Discount', -sale.loyaltyDiscount] as [string, number]] : []),
    ...(sale.deliveryCharge ? [['Delivery', sale.deliveryCharge] as [string, number]] : []),
    ...(sale.packingCharge ? [['Packing', sale.packingCharge] as [string, number]] : []),
    ...(sale.taxAmount ? [[`Tax ${sale.taxPercent || 0}%`, sale.taxAmount] as [string, number]] : []),
    ...(sale.otherCharge ? [['Other', sale.otherCharge] as [string, number]] : []),
  ];
  for (const [label, amount] of rows) lines.push(`${label}: ${formatAmount(amount)}`);
  lines.push(`TOTAL: ${formatAmount(sale.total)}`);
  for (const payment of sale.payments || []) {
    lines.push(`${payment.method}: ${formatAmount(payment.amount)}`);
    if (payment.method === 'Cash' && payment.cashGiven != null) lines.push(`  Given: ${formatAmount(payment.cashGiven)}`);
    if (Number(payment.change) > 0) lines.push(`  Change: ${formatAmount(Number(payment.change))}`);
  }
  if (sale.refundedAmount) lines.push(`Refunded: ${formatAmount(sale.refundedAmount)} (${sale.refundStatus})`);
  lines.push(sale.orderType === 'DELIVERY' ? 'Thank you for ordering!' : 'Thank you for dining with us!');
  return lines;
}

/** Plain text for navigator.share, which WhatsApp renders as a message. */
export function receiptText(sale: Sale, settings: PrinterSettings = DEFAULT_PRINTER_SETTINGS): string {
  return [`*${settings.headerText || RESTAURANT.name}*`, ...receiptLines(sale, settings)].join('\n');
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FONT_PT: Record<PrinterSettings['receiptFontSize'], string> = {
  small: '10pt',
  normal: '11pt',
  large: '13pt',
};

/** The shop picks the date style; the format list doubles as the label. */
export function formatDate(value: string | number | Date, format: PrinterSettings['dateFormat']): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? '');
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (format) {
    case 'iso':
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    case 'dmy':
      return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
    case 'mdy':
      return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`;
    case 'time':
      return date.toLocaleTimeString();
    default:
      return date.toLocaleString();
  }
}

function itemLine(item: CartItem): string {
  const modifiers = (item.modifiers || []).map((m) => m.name).join(', ');
  return modifiers ? `${item.name} (${modifiers})` : item.name;
}

/**
 * Standalone receipt document matching the Customer Copy layout (Image 2),
 * while preserving the hooks tested in receipt.test.ts.
 */
export function receiptDocument(sale: Sale, settings: PrinterSettings): string {
  const width = settings.paperWidth === '58mm' ? '54mm' : '76mm';
  const addr1 = settings.businessAddressLine1 ?? RESTAURANT.addressLine1;
  const addr2 = settings.businessAddressLine2 ?? RESTAURANT.addressLine2;
  const phone = settings.businessPhone ?? RESTAURANT.phone;
  const payTitle = settings.paymentInfoTitle ?? RESTAURANT.accountTitle;
  const payDetails = settings.paymentInfoDetails ?? RESTAURANT.accountMethod;
  const items = (sale.items || [])
    .map(
      (item) => `<tr class="item">
        <td class="name">${escapeHtml(itemLine(item))}${item.note ? `<div class="note">${escapeHtml(item.note)}</div>` : ''}</td>
        ${
          settings.printItemPrices
            ? `<td class="num">${escapeHtml(formatDecimal(item.price))}</td>
               <td class="num">${escapeHtml(item.qty)}</td>
               <td class="num">${escapeHtml(formatDecimal(item.price * item.qty))}</td>`
            : `<td class="num" colspan="3">${escapeHtml(item.qty)} x</td>`
        }
      </tr>`,
    )
    .join('');
  const payments = (sale.payments || [])
    .map(
      (payment) => `<div class="row"><span>${escapeHtml(payment.method)}</span><span>${escapeHtml(formatAmount(payment.amount))}</span></div>
    ${payment.method === 'Cash' && payment.cashGiven != null ? `<div class="row muted"><span>Given</span><span>${escapeHtml(formatAmount(payment.cashGiven))}</span></div>` : ''}
    ${Number(payment.change) > 0 ? `<div class="row muted"><span>Change</span><span>${escapeHtml(formatAmount(Number(payment.change)))}</span></div>` : ''}`,
    )
    .join('');
  const totalRow = (label: string, amount: number, sign = '') =>
    amount ? `<div class="row"><span>${label}</span><span>${sign}${escapeHtml(formatAmount(amount))}</span></div>` : '';

  const kitchen = settings.printKitchenTicket
    ? `<section class="kitchen">
      <h1>KITCHEN ORDER</h1>
      <div class="k-meta">
        <p>Order: #${escapeHtml(sale.id)}</p>
        <p>By: ${escapeHtml(sale.serverUser || 'Staff')}</p>
        <p>Time: ${escapeHtml(new Date(sale.timestamp).toLocaleTimeString())}</p>
        <p>Type: ${escapeHtml(sale.orderType)}</p>
      </div>
      <div class="k-rule"></div>
      ${(sale.items || [])
        .map(
          (item) => `<div class="k-item">
            <span class="k-qty">${escapeHtml(item.qty)}x</span>
            <span class="k-name">${escapeHtml(itemLine(item))}${item.note ? ` — ${escapeHtml(item.note)}` : ''}</span>
          </div>`,
        )
        .join('')}
      <div class="k-rule"></div>
    </section>
    <div class="cut"></div>`
    : '';

  const orderDetails = settings.printOrderDetails
    ? `<div class="meta-block">
    <div class="row"><span>Bill #CT-${escapeHtml(sale.id)}</span><span>${escapeHtml(formatBillTimestamp(sale.timestamp))}</span></div>
    <div>Cashier: ${escapeHtml(settings.headerText || RESTAURANT.name)}</div>
    <div class="sr-only">Order ID: #${escapeHtml(sale.id)} | Date: ${escapeHtml(formatDate(sale.timestamp, settings.dateFormat))} | Server: ${escapeHtml(sale.serverUser || 'Staff')} | Type: ${escapeHtml(sale.orderType)}</div>
    ${sale.orderType === 'DINE_IN' && sale.tableNumber ? `<div>Table: ${escapeHtml(sale.tableNumber)}</div>` : ''}
  </div>`
    : '';

  const cust = sale.deliveryInfo?.phone || sale.deliveryInfo?.name ? sale.deliveryInfo : sale.customer;
  const deliveryDetails =
    settings.printDeliveryDetails && cust && (cust.name || cust.address || cust.phone)
      ? `<div class="rule"></div>
         <div class="cust-block">
           <span class="sr-only">DELIVERY DETAILS</span>
           <div>Customer: ${escapeHtml([cust.name, cust.address].filter(Boolean).join(' ') || 'N/A')}</div>
           <div>Phone: ${escapeHtml(cust.phone || 'N/A')}</div>
         </div>`
      : '';

  const totals = settings.printTotals
    ? `<div class="totals-block">
    ${totalRow('Subtotal', sale.subtotal)}
    ${totalRow(`Discount ${sale.discountPercent || 0}%`, sale.discountAmount, '-')}
    ${totalRow('Loyalty discount', sale.loyaltyDiscount || 0, '-')}
    ${totalRow('Delivery charge', sale.deliveryCharge)}
    ${totalRow('Packing charge', sale.packingCharge)}
    ${totalRow(`Tax ${sale.taxPercent || 0}%`, sale.taxAmount)}
    ${totalRow('Other charges', sale.otherCharge)}
    <div class="row grand"><span>Total Amount <span class="sr-only">GRAND TOTAL</span></span><span class="tall-amt">${escapeHtml(currencySymbol())}${escapeHtml(formatDecimal(sale.total))}</span></div>
    <div class="rule"></div>
    <div class="row"><span>Total Items: &nbsp; ${escapeHtml((sale.items || []).length)}</span><span></span></div>
    <div class="rule"></div>
    ${settings.printPayments && payments ? `<div class="sr-only"><strong>PAYMENTS</strong>${payments}</div>` : ''}
  </div>`
    : '';

  const footer = settings.printFooter
    ? `<footer>
        ${phone ? `<p class="center-phone">${escapeHtml(phone)}</p>` : ''}
        ${
          payTitle || payDetails
            ? `<div class="acct-block">
                ${payTitle ? `<div>${escapeHtml(payTitle)}</div>` : ''}
                ${payDetails ? `<div>${escapeHtml(payDetails)}</div>` : ''}
              </div>`
            : ''
        }
        ${
          settings.footerText
            ? `<p>${escapeHtml(settings.footerText)}</p>`
            : `<p class="sr-only">${escapeHtml(
                sale.orderType === 'DELIVERY'
                  ? 'Thank you for ordering delivery!'
                  : sale.orderType === 'TAKEAWAY'
                    ? 'Thank you for choosing takeaway!'
                    : 'Thank you for dining with us!',
              )}</p>`
        }
      </footer>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt #${escapeHtml(sale.id)}</title><style>
  @page { size: ${settings.paperWidth} auto; margin: 2mm; }
  * { box-sizing: border-box; }
  html, body { width: 100%; max-width: ${width}; margin: 0 auto; padding: 0; color: #000; background: #fff; }
  body { font: ${FONT_PT[settings.receiptFontSize] ?? '11pt'}/1.35 "Courier New", Courier, monospace; }
  main { width: 100%; max-width: ${width}; margin: 0 auto; padding: 0 1mm 3mm; }
  header { width: 100%; text-align: center; padding-bottom: 2mm; }
  .stamp-wrap { width: 100%; display: flex; justify-content: center; align-items: center; text-align: center; margin: 0 auto 2mm; }
  .stamp-wrap svg { display: block; margin: 0 auto; }
  .tall-title { font-size: 1.45em; transform: scaleY(1.35); transform-origin: center; margin: 1mm 0; font-weight: normal; text-align: center; }
  header h1 { margin: 1.5mm 0 1mm; font-size: 1.45em; font-weight: normal; transform: scaleY(1.35); text-align: center; }
  p { margin: 0; }
  .title { display: none; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
  .rule { margin: 2mm 0; border-top: 1px dashed #000; }
  table.items-tbl { width: 100%; border-collapse: collapse; font-size: 0.95em; }
  table.items-tbl th { text-align: left; font-weight: normal; padding-bottom: 1.5mm; border-bottom: 1px dashed #000; }
  table.items-tbl th.num, table.items-tbl td.num { text-align: right; white-space: nowrap; padding-left: 1.5mm; }
  table.items-tbl td { padding: 1.5mm 0; vertical-align: top; }
  .name { overflow-wrap: anywhere; }
  .note { font-size: 0.85em; font-style: italic; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; margin: 1mm 0; }
  .row span:last-child, .row strong { white-space: nowrap; }
  .grand { margin-top: 2mm; padding: 1.5mm 0; font-size: 1.05em; }
  .tall-amt { font-size: 1.45em; display: inline-block; transform: scaleY(1.35); }
  .muted { font-size: 0.9em; }
  footer { margin-top: 2mm; }
  .center-phone { text-align: center; margin-bottom: 1.5mm; }
  .acct-block { text-align: left; }
  .kitchen h1 { margin: 0 0 1mm; font-size: 1.3em; text-align: center; }
  .k-meta { text-align: center; margin-bottom: 1.5mm; }
  .k-rule { border-top: 1px dashed #000; margin: 1.5mm 0; }
  .k-item { display: flex; gap: 1.5mm; padding: 0.8mm 0; overflow-wrap: anywhere; }
  .k-qty { font-weight: bold; min-width: 5mm; }
  .k-name { font-weight: bold; }
  .cut { border-top: 1px dashed #000; margin: 20mm 0 15mm; }
  </style></head><body><main>
  ${kitchen}
  <header>
    <div class="stamp-wrap">
      <svg width="128" height="92" viewBox="0 0 168 120" style="display:block;margin:0 auto;" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="84" cy="60" rx="76" ry="54" fill="none" stroke="#000" stroke-width="2.5"/>
        <ellipse cx="84" cy="60" rx="71" ry="49" fill="none" stroke="#000" stroke-width="1.2"/>
        <ellipse cx="84" cy="60" rx="46" ry="31" fill="none" stroke="#000" stroke-width="1.5"/>
        <text x="84" y="21" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="10.5" letter-spacing="1">CHEFTECH</text>
        <text x="84" y="105" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="10.5" letter-spacing="1.5">RESTAURANT</text>
        <text x="26" y="64" text-anchor="middle" font-size="11">★</text>
        <text x="142" y="64" text-anchor="middle" font-size="11">★</text>
        <g transform="translate(-3, 0)">
          <path d="M66 52 Q69 42 76 44 L74 39 L79 42 L80 38 L84 43 Q82 54 90 56 Q102 40 110 48 Q102 52 98 58 Q109 50 112 60 Q103 59 98 64 Q106 62 107 70 Q94 74 80 73 Q68 71 69 60 L62 55 L67 53 Z" fill="#000"/>
          <line x1="80" y1="72" x2="78" y2="82" stroke="#000" stroke-width="2"/>
          <line x1="87" y1="72" x2="88" y2="82" stroke="#000" stroke-width="2"/>
        </g>
      </svg>
    </div>
    <div class="tall-title">Customer Copy</div>
    <h1>${escapeHtml(settings.headerText || RESTAURANT.name)}</h1>
    ${addr1 ? `<p>${escapeHtml(addr1)}</p>` : ''}
    ${addr2 ? `<p>${escapeHtml(addr2)}</p>` : ''}
    ${phone ? `<p>${escapeHtml(phone)}</p>` : ''}
  </header>
  <div class="title">ORDER RECEIPT</div>
  <div class="rule"></div>
  ${orderDetails}
  ${deliveryDetails}
  <div class="rule"></div>
  <span class="sr-only">ITEMS</span>
  <table class="items-tbl">
    <thead>
      <tr><th>Item</th><th class="num">Rate</th><th class="num">Qty</th><th class="num">Amount</th></tr>
    </thead>
    <tbody>
      ${items}
    </tbody>
  </table>
  <div class="rule"></div>
  ${totals}
  ${footer}
  </main></body></html>`;
}
