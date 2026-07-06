const crypto = require('crypto');

function safeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normaliseAmount(value) {
  return Number(value || 0).toFixed(2);
}

function normaliseDate(value) {
  if (!value) return '';

  const str = String(value);

  if (/^\d{8}$/.test(str)) {
    return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
  }

  return new Date(value).toISOString().split('T')[0];
}

function checksum(voucher) {
  return crypto
    .createHash('md5')
    .update([
      voucher.guid,
      voucher.amount,
      voucher.narration,
      voucher.date
    ].join('|'))
    .digest('hex');
}

function normalise(voucher = {}) {
  const data = {
    guid: safeString(voucher.guid),
    date: normaliseDate(voucher.date),
    partyName: safeString(voucher.partyName),
    amount: normaliseAmount(voucher.amount),
    taxAmount: normaliseAmount(voucher.taxAmount),
    narration: safeString(voucher.narration),
    salesLedger: safeString(voucher.salesLedger),
    syncStatus: safeString(voucher.syncStatus || 'pending'),
    legs: safeArray(voucher.legs).map((leg) => ({
      ledger: safeString(leg.ledger),
      amount: normaliseAmount(leg.amount)
    }))
  };

  data.checksum = checksum(data);

  return data;
}

module.exports = normalise;
