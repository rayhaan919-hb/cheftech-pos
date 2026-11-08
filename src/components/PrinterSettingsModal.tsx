import { useEffect, useState } from 'react';
import { Bluetooth, Cable, Check, Cpu, Printer, Wifi, X } from 'lucide-react';
import {
  disconnectPrinterDevice,
  disconnectSerialPrinter,
  disconnectUsbPrinter,
  getPrinterDevice,
  getPrinterSettings,
  getSerialPrinterPort,
  getUsbPrinterDevice,
  pairPrinterDevice,
  pairSerialPrinter,
  pairUsbPrinter,
  printTestReceipt,
  receiptFontClass,
  restorePrinterDevice,
  savePrinterSettings,
} from '../lib/printer';
import type {
  BluetoothDeviceLike,
  DateFormat,
  PrinterConnectionType,
  PrinterSettings,
  ReceiptFontSize,
  SerialPortLike,
  UsbDeviceLike,
} from '../lib/printer';
import { logAudit } from '../lib/audit';
import { CURRENCY_PRESETS, formatAmount, getCurrency, setCurrency } from '../lib/format';
import { getMinDeliveryOrder, setMinDeliveryOrder } from '../lib/sales';
import { formatDate, RESTAURANT } from '../lib/receipt';
import { Modal } from './Modal';

const FONT_OPTIONS: Array<{ value: ReceiptFontSize; label: string }> = [
  { value: 'small', label: 'Small (compact)' },
  { value: 'normal', label: 'Normal (default)' },
  { value: 'large', label: 'Large (readable)' },
];

const DATE_OPTIONS: Array<{ value: DateFormat; label: string }> = [
  { value: 'locale', label: 'Local (22/10/2026, 5:04 pm)' },
  { value: 'iso', label: 'ISO (2026-10-22)' },
  { value: 'dmy', label: 'Day/Month/Year (22/10/2026)' },
  { value: 'mdy', label: 'Month/Day/Year (10/22/2026)' },
  { value: 'time', label: 'Time only (5:04:22 pm)' },
];

const CONNECTION_TYPES: Array<{ value: PrinterConnectionType; label: string; icon: typeof Bluetooth }> = [
  { value: 'bluetooth', label: 'Bluetooth (BLE)', icon: Bluetooth },
  { value: 'usb', label: 'USB Cable', icon: Cable },
  { value: 'serial', label: 'Serial / COM Port', icon: Cpu },
  { value: 'lan', label: 'LAN / Wi-Fi IP', icon: Wifi },
];

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

/** The "what to print" switches, in the order they appear on the receipt. */
const PRINT_OPTIONS: Array<[keyof PrinterSettings, string]> = [
  ['printOrderDetails', 'Order details (ID, date, server, order type)'],
  ['printDeliveryDetails', 'Delivery details (name, phone, address)'],
  ['printItemPrices', 'Item prices on every line'],
  ['printTotals', 'Subtotal, discounts, charges and grand total'],
  ['printPayments', 'Payment methods and change'],
  ['printFooter', 'Footer message'],
];

export function PrinterSettingsModal({ username, notify, preview, onClose }: {
  username: string;
  notify: (message: string) => void;
  preview: { title: string; lines: Array<[string, string]>; total: number } | null;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<PrinterSettings | null>(null);
  const [btDevice, setBtDevice] = useState<BluetoothDeviceLike | null>(() => getPrinterDevice());
  const [usbDevice, setUsbDevice] = useState<UsbDeviceLike | null>(() => getUsbPrinterDevice());
  const [serialPort, setSerialPort] = useState<SerialPortLike | null>(() => getSerialPrinterPort());
  const [currencyCode, setCurrencyCode] = useState<string>(() => getCurrency().code);
  const [minDelivery, setMinDelivery] = useState<number>(() => getMinDeliveryOrder());
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    getPrinterSettings().then(setSettings);
    restorePrinterDevice().then(() => {
      setBtDevice(getPrinterDevice());
      setUsbDevice(getUsbPrinterDevice());
      setSerialPort(getSerialPrinterPort());
    });
  }, []);

  const hasBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  const hasUsb = typeof navigator !== 'undefined' && 'usb' in navigator;
  const hasSerial = typeof navigator !== 'undefined' && 'serial' in navigator;

  async function connectBluetooth() {
    if (!hasBluetooth) {
      notify('Web Bluetooth needs Chrome or Edge on desktop, or Android.');
      return;
    }
    setConnecting(true);
    try {
      const picked = await pairPrinterDevice();
      setBtDevice(picked);
      notify(`Connected to ${picked.name || 'Bluetooth thermal printer'}.`);
    } catch (err) {
      if ((err as DOMException)?.name !== 'NotFoundError') {
        notify(err instanceof Error ? err.message : 'Could not pair the Bluetooth printer.');
      }
    } finally {
      setConnecting(false);
    }
  }

  async function connectUsb() {
    if (!hasUsb) {
      notify('WebUSB needs Chrome or Edge on desktop or Android.');
      return;
    }
    setConnecting(true);
    try {
      const picked = await pairUsbPrinter();
      setUsbDevice(picked);
      notify(`Connected to ${picked.productName || 'USB thermal printer'}.`);
    } catch (err) {
      if ((err as DOMException)?.name !== 'NotFoundError') {
        notify(err instanceof Error ? err.message : 'Could not connect USB printer.');
      }
    } finally {
      setConnecting(false);
    }
  }

  async function connectSerial() {
    if (!hasSerial) {
      notify('WebSerial needs Chrome or Edge on desktop.');
      return;
    }
    setConnecting(true);
    try {
      const port = await pairSerialPrinter();
      setSerialPort(port);
      notify('Serial / COM printer port selected.');
    } catch (err) {
      if ((err as DOMException)?.name !== 'NotFoundError') {
        notify(err instanceof Error ? err.message : 'Could not open Serial/COM port.');
      }
    } finally {
      setConnecting(false);
    }
  }

  async function testPrint() {
    if (!settings) return;
    setTesting(true);
    try {
      await savePrinterSettings(settings);
      await printTestReceipt(settings.headerText || RESTAURANT.name);
      notify(`Test receipt sent via ${settings.connectionType.toUpperCase()}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Test print failed.';
      notify(message);
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    if (!settings) return;
    setCurrency(currencyCode);
    setMinDeliveryOrder(minDelivery);
    await savePrinterSettings(settings);
    await logAudit(
      'PRINTER_SETTINGS_UPDATED',
      `Mode ${settings.connectionType}, Receipt ${settings.receiptFontSize}, ${settings.paperWidth}, auto-print ${settings.autoPrint ? 'on' : 'off'}, kitchen ticket ${settings.printKitchenTicket ? 'on' : 'off'}, currency ${currencyCode}`,
      username,
    );
    notify('Settings saved successfully.');
    onClose();
  }

  const connectionType = settings?.connectionType || 'bluetooth';

  return (
    <Modal
      title="Printer & Receipt Settings"
      onClose={onClose}
      wide
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={!settings} className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            Save Settings
          </button>
        </div>
      }
    >
      {!settings ? (
        <p className="text-xs text-gray-400 text-center py-8">Loading settings...</p>
      ) : (
        <div className="space-y-3">
          <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-3">
            <SectionTitle>Thermal Printer Connection</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CONNECTION_TYPES.map((item) => {
                const Icon = item.icon;
                const active = connectionType === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setSettings({ ...settings, connectionType: item.value })}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold border transition ${
                      active
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            {connectionType === 'bluetooth' && (
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full ${btDevice ? 'bg-emerald-500' : 'bg-gray-300'}`} aria-hidden />
                  <span className="text-gray-700 font-medium">
                    {btDevice ? `Paired with ${btDevice.name || btDevice.id.slice(0, 8)}` : 'No Bluetooth printer paired'}
                  </span>
                  {btDevice && <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden />}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={connectBluetooth}
                    disabled={connecting || !hasBluetooth}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Bluetooth className="w-3.5 h-3.5" aria-hidden />
                    {connecting ? 'Pairing...' : btDevice ? 'Change Printer' : 'Pair Bluetooth Printer'}
                  </button>
                  {btDevice && (
                    <>
                      <button
                        type="button"
                        onClick={testPrint}
                        disabled={testing}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Printer className="w-3.5 h-3.5" aria-hidden />
                        {testing ? 'Printing...' : 'Test Print'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          disconnectPrinterDevice().catch(() => {});
                          setBtDevice(null);
                          notify('Bluetooth printer disconnected.');
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white border border-gray-200 text-gray-700 hover:bg-gray-100"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden /> Disconnect
                      </button>
                    </>
                  )}
                </div>
                <p className="text-[10px] text-gray-500">
                  Works with BLE ESC/POS printers (58mm &amp; 80mm). If your Bluetooth printer is paired in Windows as a COM port (Bluetooth Classic SPP), choose <strong>Serial / COM Port</strong> above.
                </p>
              </div>
            )}

            {connectionType === 'usb' && (
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full ${usbDevice ? 'bg-emerald-500' : 'bg-gray-300'}`} aria-hidden />
                  <span className="text-gray-700 font-medium">
                    {usbDevice
                      ? `Connected to ${usbDevice.productName || `USB (${usbDevice.vendorId.toString(16)}:${usbDevice.productId.toString(16)})`}`
                      : 'No USB printer connected'}
                  </span>
                  {usbDevice && <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden />}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={connectUsb}
                    disabled={connecting || !hasUsb}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Cable className="w-3.5 h-3.5" aria-hidden />
                    {connecting ? 'Connecting...' : usbDevice ? 'Change USB Printer' : 'Connect USB Printer'}
                  </button>
                  {usbDevice && (
                    <>
                      <button
                        type="button"
                        onClick={testPrint}
                        disabled={testing}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Printer className="w-3.5 h-3.5" aria-hidden />
                        {testing ? 'Printing...' : 'Test Print'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          disconnectUsbPrinter().catch(() => {});
                          setUsbDevice(null);
                          notify('USB printer disconnected.');
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white border border-gray-200 text-gray-700 hover:bg-gray-100"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden /> Disconnect
                      </button>
                    </>
                  )}
                </div>
                <p className="text-[10px] text-gray-500">
                  Direct WebUSB ESC/POS printing. If Windows claims the USB printer as a virtual COM port, use <strong>Serial / COM Port</strong> instead.
                </p>
              </div>
            )}

            {connectionType === 'serial' && (
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`w-2 h-2 rounded-full ${serialPort ? 'bg-emerald-500' : 'bg-gray-300'}`} aria-hidden />
                    <span className="text-gray-700 font-medium">
                      {serialPort ? 'Serial / COM port ready' : 'No Serial / COM port selected'}
                    </span>
                    {serialPort && <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden />}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span className="font-bold text-[10px] uppercase">Baud Rate:</span>
                    <select
                      value={settings.serialBaudRate || 9600}
                      onChange={(e) => setSettings({ ...settings, serialBaudRate: Number(e.target.value) || 9600 })}
                      className="p-1.5 text-xs rounded-lg border border-gray-200 bg-white font-semibold"
                    >
                      {BAUD_RATES.map((rate) => (
                        <option key={rate} value={rate}>{rate}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={connectSerial}
                    disabled={connecting || !hasSerial}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Cpu className="w-3.5 h-3.5" aria-hidden />
                    {connecting ? 'Opening...' : serialPort ? 'Change COM Port' : 'Select Serial / COM Port'}
                  </button>
                  {serialPort && (
                    <>
                      <button
                        type="button"
                        onClick={testPrint}
                        disabled={testing}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Printer className="w-3.5 h-3.5" aria-hidden />
                        {testing ? 'Printing...' : 'Test Print'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          disconnectSerialPrinter().catch(() => {});
                          setSerialPort(null);
                          notify('Serial printer disconnected.');
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white border border-gray-200 text-gray-700 hover:bg-gray-100"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden /> Disconnect
                      </button>
                    </>
                  )}
                </div>
                <p className="text-[10px] text-gray-500">
                  Ideal for <strong>USB-Serial</strong> printers and <strong>Bluetooth Classic (SPP)</strong> thermal printers paired in Windows/macOS as a COM port.
                </p>
              </div>
            )}

            {connectionType === 'lan' && (
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className="sm:col-span-2 block">
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">
                      Printer IP / Hostname
                    </span>
                    <input
                      type="text"
                      value={settings.lanIp || ''}
                      onChange={(e) => setSettings({ ...settings, lanIp: e.target.value })}
                      placeholder="192.168.1.200"
                      className="w-full p-2 text-xs ring-1 ring-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">
                      Port
                    </span>
                    <input
                      type="number"
                      value={settings.lanPort || 9100}
                      onChange={(e) => setSettings({ ...settings, lanPort: Number(e.target.value) || 9100 })}
                      placeholder="9100"
                      className="w-full p-2 text-xs ring-1 ring-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </label>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="flex items-center gap-2 text-xs text-gray-700">
                    <span className="text-[10px] font-bold uppercase text-gray-600">Protocol:</span>
                    <select
                      value={settings.lanProtocol || 'http'}
                      onChange={(e) =>
                        setSettings({ ...settings, lanProtocol: e.target.value as 'http' | 'websocket' })
                      }
                      className="p-1.5 text-xs rounded-lg border border-gray-200 bg-white font-semibold"
                    >
                      <option value="http">HTTP POST (Direct / Print Bridge)</option>
                      <option value="websocket">WebSocket (ws://IP:Port)</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={testPrint}
                    disabled={testing || !settings.lanIp?.trim()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Printer className="w-3.5 h-3.5" aria-hidden />
                    {testing ? 'Sending...' : 'Test LAN Print'}
                  </button>
                </div>
                <p className="text-[10px] text-gray-500">
                  Sends raw ESC/POS bytes over Wi-Fi / Ethernet to network thermal printers or a local print relay. If unreachable, receipts automatically fall back to the browser print dialog.
                </p>
              </div>
            )}
          </section>

          <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-2">
            <SectionTitle>Receipt appearance</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Font size</span>
                <select
                  value={settings.receiptFontSize}
                  onChange={(e) => setSettings({ ...settings, receiptFontSize: e.target.value as ReceiptFontSize })}
                  className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {FONT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Paper width</span>
                <select
                  value={settings.paperWidth}
                  onChange={(e) => setSettings({ ...settings, paperWidth: e.target.value as PrinterSettings['paperWidth'] })}
                  className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="58mm">58mm (32 chars)</option>
                  <option value="80mm">80mm (48 chars)</option>
                </select>
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoPrint}
                onChange={(e) => setSettings({ ...settings, autoPrint: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Print the receipt automatically when a sale is completed
            </label>

            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.printKitchenTicket}
                onChange={(e) => setSettings({ ...settings, printKitchenTicket: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Print a kitchen ticket above the customer copy
            </label>
          </section>

          <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-2">
            <SectionTitle>What to print</SectionTitle>
            {PRINT_OPTIONS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(settings[key])}
                  onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                {label}
              </label>
            ))}
          </section>

          <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-3">
            <SectionTitle>Currency & Regional Settings</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">
                  Store Currency
                </span>
                <select
                  value={currencyCode}
                  onChange={(e) => setCurrencyCode(e.target.value)}
                  className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                >
                  {CURRENCY_PRESETS.map((curr) => (
                    <option key={curr.code} value={curr.code}>
                      {curr.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">
                  Minimum Delivery Order
                </span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={minDelivery}
                  onChange={(e) => setMinDelivery(Math.max(0, Number(e.target.value) || 0))}
                  placeholder="500"
                  className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </label>
            </div>
            <p className="text-[10px] text-gray-500">
              Affects all POS displays, totals, delivery order checkout validation, and thermal printouts.
            </p>
          </section>

          <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-2">
            <SectionTitle>Business details on receipt</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Brand / Restaurant Name</span>
                <input
                  type="text"
                  value={settings.headerText}
                  onChange={(e) => setSettings({ ...settings, headerText: e.target.value })}
                  placeholder={RESTAURANT.name}
                  className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Business Phone</span>
                <input
                  type="text"
                  value={settings.businessPhone ?? ''}
                  onChange={(e) => setSettings({ ...settings, businessPhone: e.target.value })}
                  placeholder={RESTAURANT.phone}
                  className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Address Line 1</span>
                <input
                  type="text"
                  value={settings.businessAddressLine1 ?? ''}
                  onChange={(e) => setSettings({ ...settings, businessAddressLine1: e.target.value })}
                  placeholder={RESTAURANT.addressLine1}
                  className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Address Line 2</span>
                <input
                  type="text"
                  value={settings.businessAddressLine2 ?? ''}
                  onChange={(e) => setSettings({ ...settings, businessAddressLine2: e.target.value })}
                  placeholder={RESTAURANT.addressLine2}
                  className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Payment / Bank Title</span>
                <input
                  type="text"
                  value={settings.paymentInfoTitle ?? ''}
                  onChange={(e) => setSettings({ ...settings, paymentInfoTitle: e.target.value })}
                  placeholder={RESTAURANT.accountTitle}
                  className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Payment Account Details / IBAN</span>
                <input
                  type="text"
                  value={settings.paymentInfoDetails ?? ''}
                  onChange={(e) => setSettings({ ...settings, paymentInfoDetails: e.target.value })}
                  placeholder={RESTAURANT.accountMethod}
                  className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>

            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Footer text</span>
              <input
                type="text"
                value={settings.footerText}
                onChange={(e) => setSettings({ ...settings, footerText: e.target.value })}
                placeholder="Thank you for dining with us!"
                className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="block text-[10px] text-gray-500 mt-1">Leave empty to use the built-in thank-you line.</span>
            </label>
            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Date format</span>
              <select
                value={settings.dateFormat}
                onChange={(e) => setSettings({ ...settings, dateFormat: e.target.value as DateFormat })}
                className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {DATE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </section>

          {preview && (
            <section className="p-3 rounded-xl border border-dashed border-gray-300 bg-gray-50">
              <SectionTitle>Preview · {settings.paperWidth}</SectionTitle>
              <div
                className={`mx-auto bg-white border border-gray-200 rounded-lg p-3 ${receiptFontClass(settings.receiptFontSize)} font-mono text-gray-800`}
                style={{ width: settings.paperWidth === '58mm' ? 220 : 300 }}
              >
                {settings.printKitchenTicket && (
                  <>
                    <div className="text-center font-black">KITCHEN ORDER</div>
                    <div className="text-center text-gray-500">Order #42 · By: staff</div>
                    <div className="border-t border-dashed border-gray-300 my-1" />
                    <div className="font-bold">2x Zinger Burger</div>
                    <div className="border-t border-dashed border-gray-300 my-1" />
                    <div className="my-3 border-t border-dashed border-gray-400" />
                  </>
                )}
                <div className="flex justify-center mb-1.5">
                  <svg width="96" height="68" viewBox="0 0 168 120" className="block mx-auto" xmlns="http://www.w3.org/2000/svg">
                    <ellipse cx="84" cy="60" rx="76" ry="54" fill="none" stroke="#000" strokeWidth="2.5" />
                    <ellipse cx="84" cy="60" rx="71" ry="49" fill="none" stroke="#000" strokeWidth="1.2" />
                    <ellipse cx="84" cy="60" rx="46" ry="31" fill="none" stroke="#000" strokeWidth="1.5" />
                    <text x="84" y="21" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="bold" fontSize="10.5" letterSpacing="1">CHEFTECH</text>
                    <text x="84" y="105" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="bold" fontSize="10.5" letterSpacing="1.5">RESTAURANT</text>
                    <text x="26" y="64" textAnchor="middle" fontSize="11">★</text>
                    <text x="142" y="64" textAnchor="middle" fontSize="11">★</text>
                    <g transform="translate(-3, 0)">
                      <path d="M66 52 Q69 42 76 44 L74 39 L79 42 L80 38 L84 43 Q82 54 90 56 Q102 40 110 48 Q102 52 98 58 Q109 50 112 60 Q103 59 98 64 Q106 62 107 70 Q94 74 80 73 Q68 71 69 60 L62 55 L67 53 Z" fill="#000" />
                      <line x1="80" y1="72" x2="78" y2="82" stroke="#000" strokeWidth="2" />
                      <line x1="87" y1="72" x2="88" y2="82" stroke="#000" strokeWidth="2" />
                    </g>
                  </svg>
                </div>
                <div className="text-center font-semibold">Customer Copy</div>
                <div className="text-center font-bold pb-0.5">
                  {settings.headerText || RESTAURANT.name}
                </div>
                <div className="text-center text-[10px] text-gray-600 leading-tight">
                  {(settings.businessAddressLine1 ?? RESTAURANT.addressLine1) && (
                    <div>{settings.businessAddressLine1 ?? RESTAURANT.addressLine1}</div>
                  )}
                  {(settings.businessAddressLine2 ?? RESTAURANT.addressLine2) && (
                    <div>{settings.businessAddressLine2 ?? RESTAURANT.addressLine2}</div>
                  )}
                  {(settings.businessPhone ?? RESTAURANT.phone) && (
                    <div>{settings.businessPhone ?? RESTAURANT.phone}</div>
                  )}
                </div>
                <div className="border-t border-dashed border-gray-300 my-1.5" />
                {settings.printOrderDetails && (
                  <div className="text-[10px] text-gray-700 pb-1 border-b border-dashed border-gray-300 mb-1">
                    <div className="flex justify-between">
                      <span>Bill #CT-42</span>
                      <span>{formatDate(Date.now(), settings.dateFormat)}</span>
                    </div>
                    <div>Cashier: {settings.headerText || RESTAURANT.name}</div>
                  </div>
                )}
                <div className="flex justify-between text-[10px] text-gray-500 border-b border-dashed border-gray-300 pb-0.5 mb-1">
                  <span>Item</span>
                  <span>Rate · Qty · Amount</span>
                </div>
                {preview.lines.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-2">
                    <span className="truncate">{label}</span>
                    <span className="tabular-nums shrink-0">{value}</span>
                  </div>
                ))}
                {settings.printTotals && (
                  <>
                    <div className="flex justify-between font-bold border-t border-dashed border-gray-300 mt-1 pt-1">
                      <span>Total Amount</span>
                      <span className="tabular-nums">{formatAmount(preview.total)}</span>
                    </div>
                    <div className="border-t border-b border-dashed border-gray-300 my-1 py-0.5 text-[10px]">
                      Total Items: &nbsp; {preview.lines.length}
                    </div>
                  </>
                )}
                {settings.printFooter && (
                  <div className="mt-1.5 text-[10px] text-gray-700">
                    {(settings.businessPhone ?? RESTAURANT.phone) && (
                      <p className="text-center">{settings.businessPhone ?? RESTAURANT.phone}</p>
                    )}
                    {(settings.paymentInfoTitle ?? RESTAURANT.accountTitle) && (
                      <p>{settings.paymentInfoTitle ?? RESTAURANT.accountTitle}</p>
                    )}
                    {(settings.paymentInfoDetails ?? RESTAURANT.accountMethod) && (
                      <p>{settings.paymentInfoDetails ?? RESTAURANT.accountMethod}</p>
                    )}
                    {settings.footerText && <p className="text-center mt-1">{settings.footerText}</p>}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-black uppercase tracking-wider text-gray-700">{children}</p>;
}
