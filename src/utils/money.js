/**
 * Exact money math: DB NUMERIC values are parsed into integer minor units
 * (cents) so JS floating point never touches a total.
 */

function toCents(value) {
  const text = String(value).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw new Error('Invalid money value: ' + text);
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return negative ? -cents : cents;
}

function lineTotalCents(price, quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Invalid quantity');
  return toCents(price) * quantity;
}

function sumCents(lines) {
  return lines.reduce((sum, cents) => sum + cents, 0);
}

function fromCents(cents) {
  return (cents / 100).toFixed(2);
}

function formatMoney(cents, settings = {}) {
  const symbol = settings.currency_symbol || settings.currency_code || 'ETB';
  const amount = fromCents(cents).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return settings.currency_position === 'after' ? `${amount} ${symbol}` : `${symbol} ${amount}`;
}

/** VAT is display-only — it is never added to a total. */
function vatDisplay(settings = {}) {
  const rate = settings.vat_rate == null ? 15 : Number(settings.vat_rate);
  return { mode: settings.vat_mode || 'inclusive', rate, included: settings.vat_mode !== 'exclusive' };
}

module.exports = { toCents, lineTotalCents, sumCents, fromCents, formatMoney, vatDisplay };
