import { db } from './db';
import { EscPosEncoder } from './escpos';

export type ReceiptFontSize = 'small' | 'normal' | 'large';
export type DateFormat = 'locale' | 'iso' | 'dmy' | 'mdy' | 'time';
export type PrinterConnectionType = 'bluetooth' | 'usb' | 'serial' | 'lan';

export type BluetoothCharacteristicLike = {
  uuid?: string;
  properties?: {
    write?: boolean;
    writeWithoutResponse?: boolean;
  };
  writeValue?(value: BufferSource): Promise<void>;
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
};

export type BluetoothServiceLike = {
  uuid?: string;
  getCharacteristic(characteristic: string): Promise<BluetoothCharacteristicLike>;
  getCharacteristics?(): Promise<BluetoothCharacteristicLike[]>;
};

export type BluetoothGattServerLike = {
  connected: boolean;
  connect(): Promise<BluetoothGattServerLike>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothServiceLike>;
  getPrimaryServices?(): Promise<BluetoothServiceLike[]>;
};

export type BluetoothDeviceLike = {
  id: string;
  name?: string;
  gatt?: BluetoothGattServerLike;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
};

type BluetoothLike = {
  requestDevice(options: { acceptAllDevices: boolean; optionalServices: string[] }): Promise<BluetoothDeviceLike>;
  getDevices?(): Promise<BluetoothDeviceLike[]>;
};

export interface UsbEndpointLike {
  endpointNumber: number;
  direction: 'in' | 'out';
  type: 'bulk' | 'interrupt' | 'isochronous';
}

export interface UsbAlternateInterfaceLike {
  interfaceClass?: number;
  endpoints: UsbEndpointLike[];
}

export interface UsbInterfaceLike {
  interfaceNumber: number;
  alternate: UsbAlternateInterfaceLike;
  alternates: UsbAlternateInterfaceLike[];
}

export interface UsbDeviceLike {
  productName?: string;
  manufacturerName?: string;
  vendorId: number;
  productId: number;
  opened?: boolean;
  configuration?: { interfaces: UsbInterfaceLike[] } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<{ status?: string }>;
}

type UsbLike = {
  requestDevice(options: { filters: Array<Record<string, unknown>> }): Promise<UsbDeviceLike>;
  getDevices?(): Promise<UsbDeviceLike[]>;
};

export interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable?: {
    getWriter(): {
      write(chunk: Uint8Array): Promise<void>;
      releaseLock(): void;
    };
  } | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}

type SerialLike = {
  requestPort(options?: { filters?: Array<Record<string, unknown>> }): Promise<SerialPortLike>;
  getPorts?(): Promise<SerialPortLike[]>;
};

export interface PrinterSettings {
  connectionType: PrinterConnectionType;
  receiptFontSize: ReceiptFontSize;
  paperWidth: '58mm' | '80mm';
  /** Print the receipt by itself as soon as a sale is completed. */
  autoPrint: boolean;
  /** Print a kitchen ticket above the customer copy. */
  printKitchenTicket: boolean;
  /** What the receipt shows. */
  printOrderDetails: boolean;
  printDeliveryDetails: boolean;
  printItemPrices: boolean;
  printTotals: boolean;
  printPayments: boolean;
  printFooter: boolean;
  /** What the receipt says. */
  headerText: string;
  footerText: string;
  dateFormat: DateFormat;
  /** Business details on receipt */
  businessAddressLine1?: string;
  businessAddressLine2?: string;
  businessPhone?: string;
  paymentInfoTitle?: string;
  paymentInfoDetails?: string;
  /** LAN / Wi-Fi thermal printer settings. */
  lanIp: string;
  lanPort: number;
  lanProtocol: 'http' | 'websocket';
  /** USB / Bluetooth-SPP Serial COM port baud rate. */
  serialBaudRate: number;
}

export const PRINTER_SETTINGS_KEY = 'printerSettings';
const PRINTER_DEVICE_KEY = 'printerDeviceId';
const USB_PRINTER_KEY = 'usbPrinterIds';

// Common BLE service/characteristic UUIDs for ESC/POS thermal printers
// (Xprinter, Goojprt, MTP-II, PT-210, Rongta, Sunmi, HM-10/HM-16, ISSC, Nordic UART, Star).
export const PRINTER_SERVICE = '0000ffe0-0000-1000-8000-00805f9b34fb';
export const PRINTER_CHARACTERISTIC = '0000ffe1-0000-1000-8000-00805f9b34fb';

export const PRINTER_SERVICES: string[] = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-41a5-8b53-07423c5a2253',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
];

const KNOWN_SERVICE_CHARACTERISTICS: Array<[string, string]> = [
  ['000018f0-0000-1000-8000-00805f9b34fb', '00002af1-0000-1000-8000-00805f9b34fb'],
  ['0000ffe0-0000-1000-8000-00805f9b34fb', '0000ffe1-0000-1000-8000-00805f9b34fb'],
  ['49535343-fe7d-41a5-8b53-07423c5a2253', '49535343-8841-43f4-a8d4-ecbe34729bb3'],
  ['0000ff00-0000-1000-8000-00805f9b34fb', '0000ff02-0000-1000-8000-00805f9b34fb'],
  ['e7810a71-73ae-499d-8c15-faa9aef0c3f2', 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f'],
  ['6e400001-b5a3-f393-e0a9-e50e24dcca9e', '6e400002-b5a3-f393-e0a9-e50e24dcca9e'],
];

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  connectionType: 'bluetooth',
  receiptFontSize: 'normal',
  paperWidth: '80mm',
  autoPrint: true,
  printKitchenTicket: false,
  printOrderDetails: true,
  printDeliveryDetails: true,
  printItemPrices: true,
  printTotals: true,
  printPayments: true,
  printFooter: true,
  headerText: 'ChefTech Restaurant',
  footerText: '',
  dateFormat: 'locale',
  businessAddressLine1: '123 Main Street',
  businessAddressLine2: 'Your City',
  businessPhone: '0300-0000000',
  paymentInfoTitle: 'Payment Info',
  paymentInfoDetails: 'Bank / Mobile Wallet details',
  lanIp: '',
  lanPort: 9100,
  lanProtocol: 'http',
  serialBaudRate: 9600,
};

const FONT_CLASS: Record<ReceiptFontSize, string> = {
  small: 'text-[10px]',
  normal: 'text-[12px]',
  large: 'text-[14px]',
};

export function receiptFontClass(size: ReceiptFontSize): string {
  return FONT_CLASS[size] ?? FONT_CLASS.normal;
}

/** Global references to active hardware printer handles. */
let activeDevice: BluetoothDeviceLike | null = null;
let activeCharacteristic: BluetoothCharacteristicLike | null = null;
let activeUsbDevice: UsbDeviceLike | null = null;
let activeSerialPort: SerialPortLike | null = null;

function handleDisconnected() {
  activeCharacteristic = null;
}

export async function setPrinterDevice(device: BluetoothDeviceLike | null): Promise<void> {
  if (activeDevice && activeDevice !== device) {
    activeDevice.removeEventListener?.('gattserverdisconnected', handleDisconnected);
  }
  activeDevice = device;
  activeCharacteristic = null;
  if (device) {
    device.addEventListener('gattserverdisconnected', handleDisconnected);
    try {
      await db.settings.put({ key: PRINTER_DEVICE_KEY, value: device.id });
    } catch {
      // Ignore storage errors if IndexedDB is unavailable.
    }
  } else {
    try {
      await db.settings.delete(PRINTER_DEVICE_KEY);
    } catch {
      // Ignore storage errors if IndexedDB is unavailable.
    }
  }
}

export async function disconnectPrinterDevice(): Promise<void> {
  const device = activeDevice;
  activeDevice = null;
  activeCharacteristic = null;
  if (device) {
    device.removeEventListener?.('gattserverdisconnected', handleDisconnected);
    if (device.gatt?.connected) {
      device.gatt.disconnect();
    }
  }
  try {
    await db.settings.delete(PRINTER_DEVICE_KEY);
  } catch {
    // Ignore storage errors if IndexedDB is unavailable.
  }
}

export function getPrinterDevice(): BluetoothDeviceLike | null {
  return activeDevice;
}

export function getUsbPrinterDevice(): UsbDeviceLike | null {
  return activeUsbDevice;
}

export function getSerialPrinterPort(): SerialPortLike | null {
  return activeSerialPort;
}

/**
 * Resolves a writable BLE characteristic on an active GATT server by scanning
 * all exposed primary services first, then falling back to known ESC/POS UUID pairs.
 */
async function resolveWritableCharacteristic(server: BluetoothGattServerLike): Promise<BluetoothCharacteristicLike> {
  if (typeof server.getPrimaryServices === 'function') {
    try {
      const services = await server.getPrimaryServices();
      for (const service of services) {
        if (typeof service.getCharacteristics !== 'function') continue;
        try {
          const characteristics = await service.getCharacteristics();
          const writable = characteristics.find(
            (c) => c.properties?.write || c.properties?.writeWithoutResponse,
          );
          if (writable) return writable;
        } catch {
          // Continue checking remaining services.
        }
      }
    } catch {
      // Fall through to explicit UUID lookup below.
    }
  }

  for (const [serviceUuid, charUuid] of KNOWN_SERVICE_CHARACTERISTICS) {
    try {
      const service = await server.getPrimaryService(serviceUuid);
      if (typeof service.getCharacteristics === 'function') {
        try {
          const chars = await service.getCharacteristics();
          const writable = chars.find(
            (c) => c.properties?.write || c.properties?.writeWithoutResponse,
          );
          if (writable) return writable;
        } catch {
          // Fall through to specific characteristic UUID.
        }
      }
      const characteristic = await service.getCharacteristic(charUuid);
      if (characteristic) return characteristic;
    } catch {
      // Service not present on this printer; try next UUID pair.
    }
  }

  throw new Error(
    'No writable BLE printer characteristic found. If your printer uses Bluetooth Classic (SPP) or USB, select the Serial / COM or USB mode.',
  );
}

/**
 * Prompts the user to pick a Bluetooth thermal printer, connects to its GATT
 * server, and verifies that a writable printer characteristic is available.
 */
export async function pairPrinterDevice(): Promise<BluetoothDeviceLike> {
  const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth;
  if (!bluetooth?.requestDevice) {
    throw new Error('Web Bluetooth needs Chrome or Edge on desktop, or Android.');
  }

  const picked = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: PRINTER_SERVICES,
  });

  if (!picked.gatt) {
    throw new Error('Selected Bluetooth device does not support GATT connections.');
  }

  const server = picked.gatt.connected ? picked.gatt : await picked.gatt.connect();
  const characteristic = await resolveWritableCharacteristic(server);
  await setPrinterDevice(picked);
  activeCharacteristic = characteristic;
  return picked;
}

/**
 * Prompts the user to pick a USB thermal printer via WebUSB.
 */
export async function pairUsbPrinter(): Promise<UsbDeviceLike> {
  const usb = (navigator as Navigator & { usb?: UsbLike }).usb;
  if (!usb?.requestDevice) {
    throw new Error('WebUSB requires Chrome or Edge over HTTPS or localhost.');
  }
  const device = await usb.requestDevice({ filters: [] });
  await openAndClaimUsbPrinter(device);
  activeUsbDevice = device;
  try {
    await db.settings.put({
      key: USB_PRINTER_KEY,
      value: { vendorId: device.vendorId, productId: device.productId },
    });
  } catch {
    // Ignore IndexedDB error
  }
  return device;
}

export async function disconnectUsbPrinter(): Promise<void> {
  const dev = activeUsbDevice;
  activeUsbDevice = null;
  if (dev?.opened) {
    try {
      await dev.close();
    } catch {
      // Ignore close error
    }
  }
  try {
    await db.settings.delete(USB_PRINTER_KEY);
  } catch {
    // Ignore IndexedDB error
  }
}

async function openAndClaimUsbPrinter(device: UsbDeviceLike): Promise<number> {
  if (!device.opened) {
    await device.open();
  }
  if (!device.configuration) {
    await device.selectConfiguration(1);
  }
  const interfaces = device.configuration?.interfaces ?? [];
  for (const iface of interfaces) {
    const alternates = iface.alternates?.length ? iface.alternates : [iface.alternate];
    for (const alt of alternates) {
      const outEndpoint = alt?.endpoints?.find((ep) => ep.direction === 'out' && ep.type === 'bulk')
        ?? alt?.endpoints?.find((ep) => ep.direction === 'out');
      if (outEndpoint) {
        await device.claimInterface(iface.interfaceNumber);
        return outEndpoint.endpointNumber;
      }
    }
  }
  throw new Error('No bulk OUT endpoint found on the selected USB device.');
}

async function printViaUsb(bytes: Uint8Array): Promise<void> {
  if (!activeUsbDevice) {
    const usb = (navigator as Navigator & { usb?: UsbLike }).usb;
    if (usb?.getDevices) {
      try {
        const stored = await db.settings.get(USB_PRINTER_KEY);
        const ids = stored?.value as { vendorId?: number; productId?: number } | undefined;
        const devices = await usb.getDevices();
        activeUsbDevice =
          (ids ? devices.find((d) => d.vendorId === ids.vendorId && d.productId === ids.productId) : undefined) ??
          devices[0] ??
          null;
      } catch {
        // Ignore
      }
    }
  }
  if (!activeUsbDevice) {
    throw new Error('No USB printer connected. Click "Connect USB Printer" in Printer Settings.');
  }
  const endpointNumber = await openAndClaimUsbPrinter(activeUsbDevice);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  await activeUsbDevice.transferOut(endpointNumber, copy);
}

/**
 * Prompts the user to pick a Serial / COM port printer via WebSerial
 * (supports both USB-Serial and Bluetooth Classic SPP virtual COM ports).
 */
export async function pairSerialPrinter(): Promise<SerialPortLike> {
  const serial = (navigator as Navigator & { serial?: SerialLike }).serial;
  if (!serial?.requestPort) {
    throw new Error('WebSerial requires Chrome or Edge on desktop.');
  }
  const port = await serial.requestPort();
  activeSerialPort = port;
  return port;
}

export async function disconnectSerialPrinter(): Promise<void> {
  const port = activeSerialPort;
  activeSerialPort = null;
  if (port) {
    try {
      await port.close();
    } catch {
      // Ignore if not currently open
    }
  }
}

async function printViaSerial(bytes: Uint8Array, baudRate = 9600): Promise<void> {
  if (!activeSerialPort) {
    const serial = (navigator as Navigator & { serial?: SerialLike }).serial;
    if (serial?.getPorts) {
      try {
        const ports = await serial.getPorts();
        activeSerialPort = ports[0] ?? null;
      } catch {
        // Ignore
      }
    }
  }
  if (!activeSerialPort) {
    throw new Error('No Serial/COM printer selected. Click "Select Serial Port" in Printer Settings.');
  }

  try {
    await activeSerialPort.open({ baudRate: Number(baudRate) || 9600 });
  } catch {
    // Port may already be open
  }

  const writer = activeSerialPort.writable?.getWriter();
  if (!writer) {
    throw new Error('Serial printer port is not writable.');
  }
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

/**
 * Sends raw ESC/POS bytes to a LAN / Wi-Fi network thermal printer via HTTP POST or WebSocket.
 */
async function printViaLan(
  bytes: Uint8Array,
  lanIp: string,
  lanPort = 9100,
  protocol: 'http' | 'websocket' = 'http',
): Promise<void> {
  const host = (lanIp || '').trim();
  if (!host) {
    throw new Error('Enter the LAN / Wi-Fi printer IP address in Printer Settings.');
  }
  const port = Number(lanPort) || 9100;

  const payload = new Uint8Array(bytes.byteLength);
  payload.set(bytes);

  if (protocol === 'websocket') {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://${host}:${port}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Timed out connecting to ws://${host}:${port}`));
      }, 5000);
      ws.onopen = () => {
        clearTimeout(timer);
        ws.send(payload.buffer);
        ws.close();
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`Could not connect to WebSocket printer at ws://${host}:${port}`));
      };
    });
    return;
  }

  const url = host.startsWith('http://') || host.startsWith('https://') ? host : `http://${host}:${port}/`;
  await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: payload,
  });
}

/**
 * Reconnects to previously permitted Bluetooth / USB / Serial printers on startup.
 */
export async function restorePrinterDevice(): Promise<void> {
  // Restore WebUSB device if available
  const usb = (navigator as Navigator & { usb?: UsbLike }).usb;
  if (!activeUsbDevice && usb?.getDevices) {
    try {
      const storedUsb = await db.settings.get(USB_PRINTER_KEY);
      const ids = storedUsb?.value as { vendorId?: number; productId?: number } | undefined;
      if (ids) {
        const devices = await usb.getDevices();
        activeUsbDevice =
          devices.find((d) => d.vendorId === ids.vendorId && d.productId === ids.productId) ?? null;
      }
    } catch {
      // Ignore
    }
  }

  // Restore WebSerial port if available
  const serial = (navigator as Navigator & { serial?: SerialLike }).serial;
  if (!activeSerialPort && serial?.getPorts) {
    try {
      const ports = await serial.getPorts();
      if (ports.length > 0) activeSerialPort = ports[0];
    } catch {
      // Ignore
    }
  }

  if (activeDevice) return;
  let deviceId: string | undefined;
  try {
    const stored = await db.settings.get(PRINTER_DEVICE_KEY);
    deviceId = stored?.value as string | undefined;
  } catch {
    return;
  }
  if (!deviceId) return;

  const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth;
  if (!bluetooth?.getDevices) return;

  try {
    const devices = await bluetooth.getDevices();
    const matched = devices.find((d) => d.id === deviceId) ?? devices[0];
    if (!matched) return;

    matched.addEventListener('gattserverdisconnected', handleDisconnected);
    activeDevice = matched;
    if (matched.gatt && !matched.gatt.connected) {
      const server = await matched.gatt.connect();
      activeCharacteristic = await resolveWritableCharacteristic(server);
    }
  } catch {
    // Printer out of range or asleep — keep activeDevice if found so printRaw can retry on demand.
  }
}

async function writeChunks(
  characteristic: BluetoothCharacteristicLike,
  bytes: Uint8Array,
  chunkSize: number,
  delayMs: number,
): Promise<void> {
  const writeFn =
    characteristic.writeValueWithResponse?.bind(characteristic) ??
    characteristic.writeValue?.bind(characteristic) ??
    characteristic.writeValueWithoutResponse?.bind(characteristic);

  if (!writeFn) {
    throw new Error('Printer characteristic does not support write operations.');
  }

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    await writeFn(chunk);
    if (delayMs > 0 && i + chunkSize < bytes.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function printViaBluetooth(bytes: Uint8Array): Promise<void> {
  if (!activeDevice) {
    await restorePrinterDevice();
  }
  const device = activeDevice;
  if (!device) {
    throw new Error('No Bluetooth printer paired. Please pair a printer in settings.');
  }
  if (!device.gatt) {
    throw new Error('Selected device does not expose a Bluetooth GATT server.');
  }

  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  if (!server) {
    throw new Error('Could not connect to printer GATT server.');
  }

  if (!activeCharacteristic) {
    activeCharacteristic = await resolveWritableCharacteristic(server);
  }

  try {
    await writeChunks(activeCharacteristic, bytes, 64, 15);
  } catch {
    const freshServer = device.gatt.connected ? device.gatt : await device.gatt.connect();
    activeCharacteristic = await resolveWritableCharacteristic(freshServer);
    await writeChunks(activeCharacteristic, bytes, 20, 20);
  }
}

/**
 * Sends raw ESC/POS bytes to the configured thermal printer (Bluetooth, USB, Serial, or LAN/Wi-Fi).
 */
export async function printRaw(bytes: Uint8Array): Promise<void> {
  let settings = DEFAULT_PRINTER_SETTINGS;
  try {
    settings = await getPrinterSettings();
  } catch {
    // Use defaults when IndexedDB is unavailable in unit tests
  }

  const mode = settings.connectionType || 'bluetooth';

  if (mode === 'usb') {
    await printViaUsb(bytes);
    return;
  }
  if (mode === 'serial') {
    await printViaSerial(bytes, settings.serialBaudRate);
    return;
  }
  if (mode === 'lan') {
    await printViaLan(bytes, settings.lanIp, settings.lanPort, settings.lanProtocol);
    return;
  }

  await printViaBluetooth(bytes);
}

/**
 * Sends a short ESC/POS test slip to verify the active thermal printer immediately.
 */
export async function printTestReceipt(headerText = 'ChefTech Restaurant'): Promise<void> {
  const settings = await getPrinterSettings().catch(() => DEFAULT_PRINTER_SETTINGS);
  const encoder = new EscPosEncoder();
  encoder.initialize();
  encoder.align('center');
  encoder.bold(true);
  encoder.text(headerText);
  encoder.bold(false);
  encoder.text('--------------------------------');
  encoder.text(`Thermal Printer Test (${(settings.connectionType || 'bluetooth').toUpperCase()})`);
  encoder.text(new Date().toLocaleString());
  encoder.text('Status: CONNECTED & READY');
  encoder.text('--------------------------------');
  encoder.feed(3);
  encoder.cut();
  await printRaw(encoder.build());
}

export async function getPrinterSettings(): Promise<PrinterSettings> {
  try {
    const stored = await db.settings.get(PRINTER_SETTINGS_KEY);
    return { ...DEFAULT_PRINTER_SETTINGS, ...(stored?.value as Partial<PrinterSettings> | undefined) };
  } catch {
    return { ...DEFAULT_PRINTER_SETTINGS };
  }
}

export async function savePrinterSettings(settings: PrinterSettings): Promise<void> {
  await db.settings.put({ key: PRINTER_SETTINGS_KEY, value: settings });
}
