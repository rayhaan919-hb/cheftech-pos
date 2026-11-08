export interface CurrencyPreset {
  code: string;
  locale: string;
  label: string;
  receiptSymbol: string;
}

export const CURRENCY_PRESETS: CurrencyPreset[] = [
  { code: 'PKR', locale: 'en-PK', label: 'PKR - Pakistani Rupee (Rs)', receiptSymbol: 'Rs' },
  { code: 'USD', locale: 'en-US', label: 'USD - US Dollar ($)', receiptSymbol: '$' },
  { code: 'EUR', locale: 'de-DE', label: 'EUR - Euro (€)', receiptSymbol: 'EUR' },
  { code: 'GBP', locale: 'en-GB', label: 'GBP - British Pound (£)', receiptSymbol: 'GBP' },
  { code: 'INR', locale: 'en-IN', label: 'INR - Indian Rupee (₹)', receiptSymbol: 'Rs' },
  { code: 'AED', locale: 'en-AE', label: 'AED - UAE Dirham (AED)', receiptSymbol: 'AED' },
  { code: 'SAR', locale: 'en-SA', label: 'SAR - Saudi Riyal (SAR)', receiptSymbol: 'SAR' },
  { code: 'CAD', locale: 'en-CA', label: 'CAD - Canadian Dollar ($)', receiptSymbol: '$' },
  { code: 'AUD', locale: 'en-AU', label: 'AUD - Australian Dollar ($)', receiptSymbol: '$' },
  { code: 'BDT', locale: 'en-BD', label: 'BDT - Bangladeshi Taka (Tk)', receiptSymbol: 'Tk' },
];

const CURRENCY_STORAGE_KEY = 'cheftech_currency';

export function getCurrency(): CurrencyPreset {
  if (typeof localStorage !== 'undefined') {
    try {
      const code = localStorage.getItem(CURRENCY_STORAGE_KEY);
      if (code) {
        const found = CURRENCY_PRESETS.find((c) => c.code === code);
        if (found) return found;
      }
    } catch {
      // ignore
    }
  }
  return CURRENCY_PRESETS[0]; // Default PKR / en-PK
}

export function setCurrency(code: string): CurrencyPreset {
  const found = CURRENCY_PRESETS.find((c) => c.code === code) ?? CURRENCY_PRESETS[0];
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(CURRENCY_STORAGE_KEY, found.code);
    } catch {
      // ignore
    }
  }
  return found;
}

export function currencySymbol(): string {
  return getCurrency().receiptSymbol;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(currency: CurrencyPreset): Intl.NumberFormat {
  const key = `${currency.locale}:${currency.code}`;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(currency.locale, {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    formatterCache.set(key, fmt);
  }
  return fmt;
}

export function formatAmount(amount: number): string {
  return getFormatter(getCurrency()).format(Number(amount) || 0);
}

/** Currency for money that is written back to the database, so paid amounts stay whole units. */
export function roundAmount(amount: number): number {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

/** Clamps a user-entered charge to a non-negative number. */
export function normalizeCharge(value: number | string, maximum = Infinity): number {
  const amount = parseFloat(String(value));
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.min(amount, maximum);
}
