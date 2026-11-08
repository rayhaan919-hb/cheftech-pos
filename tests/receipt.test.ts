import { describe, expect, it } from 'vitest';
import { formatDate, generateEscPosReceipt, receiptDocument, receiptLines, receiptText } from '../src/lib/receipt';
import type { Sale } from '../src/lib/db/types';

const sale: Sale = {
  id: 42,
  timestamp: '2026-10-20T12:00:00.000Z',
  orderType: 'DELIVERY',
  serverUser: 'owner',
  items: [
    { id: 'm1', menuItemId: 'm1', name: 'Zinger Burger', price: 650, qty: 2 },
    { id: 'm2', menuItemId: 'm2', name: 'Cola <500ml>', price: 150, qty: 1, refundedQty: 1 },
  ],
  subtotal: 1450,
  discountPercent: 10,
  discountAmount: 145,
  deliveryCharge: 100,
  packingCharge: 0,
  taxPercent: 0,
  taxAmount: 0,
  otherCharge: 0,
  total: 1405,
  payments: [{ method: 'Cash', amount: 1500, cashGiven: 1500, change: 95 }],
  totalReceived: 1500,
  totalChange: 95,
  deliveryInfo: { name: 'Ayesha', phone: '03001234567', address: 'Model Town' },
};

const settings = {
  connectionType: 'bluetooth' as const,
  receiptFontSize: 'normal' as const,
  paperWidth: '80mm' as const,
  autoPrint: true,
  printKitchenTicket: true,
  printOrderDetails: true,
  printDeliveryDetails: true,
  printItemPrices: true,
  printTotals: true,
  printPayments: true,
  printFooter: true,
  headerText: 'ChefTech Restaurant',
  footerText: '',
  dateFormat: 'locale' as const,
  lanIp: '',
  lanPort: 9100,
  lanProtocol: 'http' as const,
  serialBaudRate: 9600,
};

describe('receipt', () => {
  it('lists items, charges and payments in print order', () => {
    // Intl puts a non-breaking space after "Rs"; compare with plain spaces.
    const lines = receiptLines(sale).map((line) => line.replace(/ /g, ' '));
    expect(lines[0]).toBe('Order #42');
    expect(lines).toContain('Zinger Burger x2  Rs 1,300');
    expect(lines).toContain('  (refunded 1)');
    expect(lines).toContain('Discount 10%: -Rs 145');
    expect(lines).toContain('TOTAL: Rs 1,405');
    expect(lines).toContain('  Change: Rs 95');
  });

  it('shares a WhatsApp-ready message', () => {
    const text = receiptText(sale);
    expect(text.startsWith('*ChefTech Restaurant*')).toBe(true);
    expect(text).toContain('Address: Model Town');
  });

  it('escapes item names and sizes the page to the paper', () => {
    const html58 = receiptDocument(sale, { ...settings, paperWidth: '58mm' });
    expect(html58).toContain('Cola &lt;500ml&gt;');
    expect(html58).not.toContain('Cola <500ml>');
    expect(html58).toContain('@page { size: 58mm auto;');
    expect(receiptDocument(sale, settings)).toContain('@page { size: 80mm auto;');
  });

  it('prints the restaurant name as the receipt header', () => {
    const html = receiptDocument(sale, settings);
    expect(html).toContain('<h1>ChefTech Restaurant</h1>');
    expect(html).not.toContain('CHEFTECH RESTAURANT');
  });

  it('prints a kitchen ticket above the customer copy, with a gap to tear on', () => {
    const html = receiptDocument(sale, settings);
    expect(html).toContain('KITCHEN ORDER');
    expect(html.indexOf('KITCHEN ORDER')).toBeLessThan(html.indexOf('ORDER RECEIPT'));
    // The cut line is padded so the two slips do not touch.
    expect(html).toMatch(/\.cut \{[^}]*margin: (?:12mm 0 10mm|20mm 0 15mm)/);
  });

  it('leaves the kitchen ticket off when the shop turns it off', () => {
    const html = receiptDocument(sale, { ...settings, printKitchenTicket: false });
    expect(html).not.toContain('KITCHEN ORDER');
    expect(html).toContain('ORDER RECEIPT');
  });

  it('uses the custom header and footer text', () => {
    const html = receiptDocument(sale, { ...settings, headerText: 'HB Grill', footerText: 'Call again!' });
    expect(html).toContain('<h1>HB Grill</h1>');
    expect(html).toContain('Call again!');
    expect(html).not.toContain('Thank you for dining with us!');
  });

  it('drops the sections the shop turns off', () => {
    const html = receiptDocument(sale, {
      ...settings,
      printOrderDetails: false,
      printDeliveryDetails: false,
      printItemPrices: false,
      printTotals: false,
      printPayments: false,
      printFooter: false,
    });
    expect(html).not.toContain('DELIVERY DETAILS');
    expect(html).not.toContain('GRAND TOTAL');
    expect(html).not.toContain('PAYMENTS');
    expect(html).not.toContain('Server:');
    expect(html).toContain('ITEMS');
    expect(html).toContain('Zinger Burger');
  });

  it('formats the date the way the shop asked', () => {
    // Local time, so the assertion does not depend on the machine's timezone.
    const stamp = new Date(2026, 9, 20, 12, 0, 0);
    expect(formatDate(stamp, 'iso')).toBe('2026-10-20');
    expect(formatDate(stamp, 'dmy')).toBe('20/10/2026');
    expect(formatDate(stamp, 'mdy')).toBe('10/20/2026');
    expect(receiptDocument(sale, { ...settings, dateFormat: 'iso' })).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
  });

  it('discovers writable BLE characteristics across thermal printer services and keeps pairing across disconnects', async () => {
    const { setPrinterDevice, getPrinterDevice, printRaw, disconnectPrinterDevice } = await import('../src/lib/printer');
    const writtenChunks: Uint8Array[] = [];
    const listeners: Record<string, Array<() => void>> = {};

    const mockChar = {
      properties: { write: true, writeWithoutResponse: true },
      writeValueWithResponse: async (buf: BufferSource) => {
        writtenChunks.push(new Uint8Array(buf as ArrayBuffer));
      },
    };

    const mockServer = {
      connected: false,
      connect: async () => {
        mockServer.connected = true;
        return mockServer;
      },
      disconnect: () => {
        mockServer.connected = false;
        for (const fn of listeners['gattserverdisconnected'] || []) fn();
      },
      getPrimaryServices: async () => [
        {
          uuid: '000018f0-0000-1000-8000-00805f9b34fb',
          getCharacteristic: async () => mockChar,
          getCharacteristics: async () => [mockChar],
        },
      ],
      getPrimaryService: async () => ({
        getCharacteristic: async () => mockChar,
      }),
    };

    const mockDevice = {
      id: 'printer-18f0',
      name: 'XP-80C',
      gatt: mockServer,
      addEventListener: (type: string, fn: () => void) => {
        (listeners[type] ||= []).push(fn);
      },
      removeEventListener: (type: string, fn: () => void) => {
        listeners[type] = (listeners[type] || []).filter((l) => l !== fn);
      },
    };

    await setPrinterDevice(mockDevice);
    await printRaw(new Uint8Array([0x1b, 0x40, 0x48, 0x69, 0x0a]));
    expect(writtenChunks.length).toBe(1);

    // Simulate printer sleeping / disconnecting GATT between prints — device must remain paired!
    mockServer.disconnect();
    expect(getPrinterDevice()?.id).toBe('printer-18f0');

    // Next print automatically reconnects and prints again
    await printRaw(new Uint8Array([0x1b, 0x40, 0x4f, 0x4b, 0x0a]));
    expect(writtenChunks.length).toBe(2);

    await disconnectPrinterDevice();
    expect(getPrinterDevice()).toBeNull();
  });

  it('encodes ESC/POS receipt matching the Customer Copy layout without non-ASCII currency artifacts', () => {
    const bytes = generateEscPosReceipt(sale, { ...settings, printKitchenTicket: false });
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toContain('Customer Copy');
    expect(decoded).toContain('ChefTech Restaurant');
    expect(decoded).toContain('123 Main Street');
    expect(decoded).toContain('Your City');
    expect(decoded).toContain('Bill #CT-42');
    expect(decoded).toContain('Cashier: ChefTech Restaurant');
    expect(decoded).toContain('Customer: Ayesha Model Town');
    expect(decoded).toContain('Phone: 03001234567');
    expect(decoded).toMatch(/Item\s+Rate\s+Qty\s+Amount/);
    expect(decoded).toMatch(/Zinger Burger\s+650\.00\s+2\s+1,300\.00/);
    expect(decoded).toContain('Total Amount');
    expect(decoded).toContain('Rs1,405.00');
    expect(decoded).toContain('Total Items:   2');
    expect(decoded).toContain('Account Holder Name');
    expect(decoded).toContain('Jazzcash/Easypaisa');
    expect(decoded).not.toContain('\u00A0');
  });
});
