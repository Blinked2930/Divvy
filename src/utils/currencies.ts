// src/utils/currencies.ts
export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  popular?: boolean;
}

export const GLOBAL_CURRENCIES: CurrencyInfo[] = [
  // Popular / Common
  { code: 'ALL', name: 'Albanian Lek', symbol: 'L', popular: true },
  { code: 'EUR', name: 'Euro', symbol: '€', popular: true },
  { code: 'USD', name: 'US Dollar', symbol: '$', popular: true },
  { code: 'GBP', name: 'British Pound', symbol: '£', popular: true },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', popular: true },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', popular: true },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', popular: true },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', popular: true },

  // Global Currencies
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED' },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'BGN', name: 'Bulgarian Lev', symbol: 'lv' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł' },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei' },
  { code: 'RSD', name: 'Serbian Dinar', symbol: 'din' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
];

export const EXCHANGE_RATES: Record<string, number> = {
  ALL: 1,
  EUR: 100,
  USD: 90,
  GBP: 118,
  CHF: 105,
  CAD: 68,
  AUD: 60,
  JPY: 0.62,
};

export const CURRENCY_SYMBOLS: Record<string, string> = {
  ALL: "L",
  EUR: "€",
  USD: "$",
  GBP: "£",
  CHF: "CHF",
  CAD: "CA$",
  AUD: "A$",
  JPY: "¥",
};

const rateCache: Record<string, { rate: number; timestamp: number }> = {};
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour cache

export async function fetchExchangeRate(fromCurrency: string, toCurrency: string): Promise<number> {
  const from = fromCurrency.trim().toUpperCase();
  const to = toCurrency.trim().toUpperCase();
  if (from === to) return 1;

  const cacheKey = `${from}_${to}`;
  const cached = rateCache[cacheKey];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.rate;
  }

  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${from}`);
    if (!res.ok) throw new Error('FX rate fetch failed');
    const data = await res.json();
    const rate = data?.rates?.[to];

    if (rate && typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
      rateCache[cacheKey] = { rate, timestamp: Date.now() };
      return rate;
    }
  } catch (err) {
    console.warn(`Could not fetch live rate for ${from} -> ${to}, using fallback.`, err);
  }

  const fromRate = EXCHANGE_RATES[from];
  const toRate = EXCHANGE_RATES[to];
  if (fromRate && toRate) {
    return fromRate / toRate;
  }

  return 1;
}

export function formatCurrency(
  amount: number,
  currency: string = "ALL",
  showSign: boolean = false
): string {
  const code = currency.trim().toUpperCase();
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const signPrefix = showSign ? (isNegative ? "-" : "+") : isNegative ? "-" : "";

  if (code === "ALL") {
    const formatted = Math.round(absAmount).toLocaleString("en-US");
    return `${signPrefix}${formatted} L`;
  }

  const found = GLOBAL_CURRENCIES.find((c) => c.code === code);
  const symbol = found ? found.symbol : (CURRENCY_SYMBOLS[code] || code);

  const formatted = absAmount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (symbol === code || symbol.length > 2) {
    return `${signPrefix}${formatted} ${code}`;
  }

  return `${signPrefix}${symbol}${formatted}`;
}

export function convertToALL(amount: number, currency: string, customRate?: number): number {
  const code = currency.trim().toUpperCase();
  if (code === "ALL") return Math.round(amount * 100) / 100;
  const rate = customRate ?? EXCHANGE_RATES[code] ?? 1;
  return Math.round(amount * rate * 100) / 100;
}

export function convertFromALL(amountALL: number, currency: string, customRateToALL?: number): number {
  const code = currency.trim().toUpperCase();
  if (code === "ALL") return Math.round(amountALL);
  const rate = customRateToALL ?? EXCHANGE_RATES[code] ?? 1;
  return Number((amountALL / rate).toFixed(2));
}