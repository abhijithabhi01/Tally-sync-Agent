const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
require('dotenv').config();

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['TALLYMESSAGE', 'VOUCHER', 'ALLLEDGERENTRIES.LIST'].includes(name)
});

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function postXML(xml) {
  const response = await axios.post(process.env.TALLY_URL, xml, {
    headers: { 'Content-Type': 'text/xml' },
    timeout: 20000
  });
  return response.data;
}

async function healthCheck() {
  try {
    const r = await axios.get(process.env.TALLY_URL, {
      timeout: 5000,
      headers: { Accept: '*/*' }
    });
    return r.status === 200;
  } catch {
    return false;
  }
}

function extractAmount(entries) {
  const arr = Array.isArray(entries) ? entries : entries ? [entries] : [];
  for (const e of arr) {
    const amt = parseFloat(e?.AMOUNT || '0');
    if (amt < 0) return String(Math.abs(amt));
  }
  for (const e of arr) {
    const amt = parseFloat(e?.AMOUNT || '0');
    if (amt > 0) return String(amt);
  }
  return '0';
}

function findVouchers(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return [];
  const results = [];
  for (const [key, val] of Object.entries(obj)) {
    if (key === 'VOUCHER') {
      const arr = Array.isArray(val) ? val : [val];
      results.push(...arr.filter(v => v && v.DATE));
    } else if (typeof val === 'object') {
      results.push(...findVouchers(val, depth + 1));
    }
  }
  return results;
}

async function fetchSalesVouchers(fromDate, toDate) {
  const fromStr = fromDate.replace(/-/g, '');
  const toStr = toDate.replace(/-/g, '');
  const fromNum = parseInt(fromStr, 10);
  const toNum = parseInt(toStr, 10);

  const xml = `
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Voucher Register</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVFROMDATE>${fromStr}</SVFROMDATE>
          <SVTODATE>${toStr}</SVTODATE>
          <SVVOUCHERTYPE>Sales</SVVOUCHERTYPE>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;

  const rawResponse = await postXML(xml);
  const parsed = parser.parse(rawResponse);
  const allVouchers = findVouchers(parsed);

  const salesVouchers = allVouchers.filter(v => {
    const vType = String(v.VOUCHERTYPENAME || '').trim();
    if (vType && vType !== 'Sales') return false;
    const dateNum = parseInt(String(v.DATE).replace(/-/g, ''), 10);
    if (isNaN(dateNum)) return false;
    if (dateNum < fromNum || dateNum > toNum) return false;
    return true;
  });

  return salesVouchers.map(v => ({
    GUID: v.GUID || v['@_REMOTEID'] || '',
    DATE: String(v.DATE),
    PARTYNAME: v.PARTYLEDGERNAME || v.PARTYNAME || '',
    AMOUNT: extractAmount(v['ALLLEDGERENTRIES.LIST']),
    NARRATION: v.NARRATION || ''
  }));
}

/**
 * Write a voucher to Tally.
 *
 * FIX: Tally Sales vouchers require a proper double-entry:
 *   - Debit  leg: Party ledger  → positive amount (the debtor/customer)
 *   - Credit leg: Sales ledger  → negative amount (income account)
 *
 * If caller supplies explicit legs[], use those.
 * Otherwise auto-build from partyName + salesLedger.
 */
async function writeVoucherToTally(voucher) {
  const amount = parseFloat(voucher.amount || 0);

  let legs = Array.isArray(voucher.legs) && voucher.legs.length >= 2
    ? voucher.legs
    : null;

  if (!legs) {
    const partyLedger = voucher.partyName;
    const salesLedger = voucher.salesLedger || process.env.DEFAULT_SALES_LEDGER || 'Sales';

    if (!partyLedger) throw new Error('partyName is required to create a Tally voucher');

    legs = [
      { ledger: partyLedger, amount: amount },   // Debit  (positive in Tally)
      { ledger: salesLedger, amount: -amount }    // Credit (negative in Tally)
    ];
  }

  const legsXml = legs
    .map(leg => {
      const amt = parseFloat(leg.amount);
      return `
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${escapeXml(leg.ledger)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>${amt >= 0 ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
        <AMOUNT>${escapeXml(String(amt))}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`;
    })
    .join('');
  // Convert ISO date (YYYY-MM-DD) or already-compact (YYYYMMDD) to Tally's 8-digit format
  const dateStr = String(voucher.date || '').replace(/-/g, '');

  if (!dateStr || dateStr.length !== 8) {
    throw new Error(`Invalid date for Tally: "${voucher.date}" → "${dateStr}"`);
  }
  const xml = `
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        ${process.env.TALLY_COMPANY ? `<STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(process.env.TALLY_COMPANY)}</SVCURRENTCOMPANY></STATICVARIABLES>` : ''}
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
            <DATE>${dateStr}</DATE>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <PARTYLEDGERNAME>${escapeXml(voucher.partyName)}</PARTYLEDGERNAME>
            <NARRATION>${escapeXml(voucher.narration || '')}</NARRATION>
            ${legsXml}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

  const response = await postXML(xml);

  // Current check — misses the case where EXCEPTIONS=1 but no LINEERROR text:
  if (response.includes('LINEERROR') || response.includes('<EXCEPTIONS>1</EXCEPTIONS>')) {
    throw new Error(response);  // ← throws the full XML blob
  }
  if (!response.includes('<CREATED>1</CREATED>')) {
    throw new Error(`Voucher creation failed. Tally response: ${response.slice(0, 600)}`);
  }
  return true;
}

module.exports = { fetchSalesVouchers, writeVoucherToTally, healthCheck };
