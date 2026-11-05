export const currencies = ["SGD", "VND", "MYR", "JPY", "USD", "THB", "AUD", "CAD", "CHF", "CNY", "EUR", "GBP", "HKD", "IDR", "INR", "KRW", "NZD", "PHP", "TWD"];

export function pressKey(value: string, key: string, currency = "SGD") {
  if (key === "delete") return value.slice(0, -1) || "0";
  if (key === ".") return value.includes(".") || value.length > 10 ? value : value + ".";
  if (!/^\d$/.test(key)) return value;
  const [whole, fraction] = value.split(".");
  if ((fraction !== undefined && fraction.length >= 2) || (fraction === undefined && whole.length >= (currency === "SGD" ? 12 : 10))) return value;
  return value === "0" ? key : value + key;
}

// SGD digits represent cents until the user explicitly presses the decimal key.
export function keypadDisplay(input: string, currency: string) {
  if (currency !== "SGD" || input.includes(".")) return input;
  const digits = input.padStart(3, "0");
  return digits.slice(0, -2) + "." + digits.slice(-2);
}

export function keypadInput(amount: number, currency: string) {
  return currency === "SGD" ? String(Math.round(amount * 100)) : String(amount);
}

// Each operand follows the same entry rules as a single expense amount.
export function calculationKey(input: string, key: string, currency: string) {
  if (key === "delete") return input.slice(0, -1) || "0";
  if (key === "+" || key === "-") return input.replace(/[+-]$/, "") + key;
  const start = Math.max(input.lastIndexOf("+"), input.lastIndexOf("-")) + 1;
  return input.slice(0, start) + pressKey(input.slice(start) || "0", key, currency);
}

export function calculation(input: string, currency: string) {
  const tokens = input.split(/([+-])/);
  const parts = tokens.map((part, i) => {
    if (i % 2) return part === "-" ? " − " : " + ";
    return part ? keypadDisplay(part, currency) : "";
  });
  if (parts.length === 1) return { display: parts[0], value: Number(parts[0]), expression: "", complete: true };
  let cents = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const operand = Math.round(Number(parts[i]) * 100);
    cents += tokens[i-1] === "-" ? -operand : operand;
  }
  return { display: (cents / 100).toFixed(2), value: cents / 100, expression: parts.join(""), complete: !!tokens.at(-1) };
}

export function changeKeypadCurrency(input: string, from: string, to: string) {
  return input.split(/([+-])/).map((part, i) =>
    i % 2 || !part ? part : keypadInput(Number(keypadDisplay(part, from)), to)
  ).join("");
}

export function asCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value: number | string, currency = "SGD") {
  return new Intl.NumberFormat("en-SG", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(Number(value));
}

export function dateLabel(value: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-SG", { ...options, timeZone: "UTC" }).format(new Date(value + "T12:00:00Z"));
}

export function currencyOrder(household: string) {
  try {
    const recent = JSON.parse(localStorage.getItem("hh-currencies-" + household) || "[]");
    return [...new Set(["SGD", ...(Array.isArray(recent) ? recent.filter((s: string) => currencies.includes(s)) : []), ...currencies])];
  } catch { return [...currencies]; }
}

export function rememberCurrency(household: string, currency: string) {
  try {
    localStorage.setItem("hh-currencies-" + household, JSON.stringify([currency, ...currencyOrder(household).filter(c => c !== currency)].slice(0, 5)));
  } catch { /* Private browsing can disable persistent storage. */ }
}

