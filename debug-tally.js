/**
 * debug-tally.js  (v4)
 * ---------------------
 * Tries every known Tally report name to find which one
 * returns actual Sales voucher data in Tally EDU.
 *
 * USAGE:  node debug-tally.js
 */
require('dotenv').config();
const axios = require('axios');

const TALLY_URL = process.env.TALLY_URL;

async function tryReport(reportName, extraVars = '') {
  const xml = `
<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>${reportName}</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          ${extraVars}
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;

  try {
    const res = await axios.post(TALLY_URL, xml, {
      headers: { 'Content-Type': 'text/xml' },
      timeout: 8000
    });
    const raw = res.data.slice(0, 200).replace(/\n/g, ' ').trim();
    const hasVoucher = res.data.includes('<VOUCHER') || res.data.includes('VOUCHER>');
    const hasError   = res.data.includes('Unknown Request') || res.data.includes('LONGPROMPT');
    return { reportName, raw, hasVoucher, hasError, size: res.data.length };
  } catch (e) {
    return { reportName, raw: e.message, hasVoucher: false, hasError: true, size: 0 };
  }
}

async function run() {
  console.log('\n🔍  TALLY REPORT PROBE — finding correct export report\n');
  console.log('URL:', TALLY_URL, '\n');

  // Every known Tally report that could contain Sales vouchers
  const reports = [
    ['Day Book',            '<SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20260511</SVTODATE>'],
    ['Voucher Register',    '<SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20260511</SVTODATE><SVVOUCHERTYPE>Sales</SVVOUCHERTYPE>'],
    ['Sales Register',      '<SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20260511</SVTODATE>'],
    ['Sales',               '<SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20260511</SVTODATE>'],
    ['List of Vouchers',    '<SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20260511</SVTODATE>'],
    ['Transactions',        '<SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20260511</SVTODATE>'],
    ['List of Accounts',    ''],
    ['All Masters',         ''],
    ['List of Ledgers',     ''],
  ];

  let winner = null;

  for (const [name, vars] of reports) {
    const r = await tryReport(name, vars);
    const icon = r.hasVoucher ? '✅' : r.hasError ? '❌' : '⚠️ ';
    console.log(`${icon}  "${name}"`);
    if (r.hasVoucher) {
      console.log(`    → VOUCHER DATA FOUND! Size: ${r.size} bytes`);
      console.log(`    → Preview: ${r.raw}`);
      winner = { name, vars, raw: r.raw };
    } else {
      console.log(`    → ${r.raw.slice(0, 120)}`);
    }
    console.log();
  }

  if (winner) {
    console.log(`\n🎉  USE THIS REPORT: "${winner.name}"`);
    console.log('    Copy the report name above into tallyClient.js\n');
  } else {
    console.log('\n⚠️  No report returned VOUCHER data directly.');
    console.log('    This means Tally EDU blocks all export reports.');
    console.log('    Trying direct GET fetch of voucher data...\n');

    // Last resort: try the root URL with different methods
    try {
      const r = await axios.get(TALLY_URL, { timeout: 5000 });
      console.log('GET response:', r.data.slice(0, 200));
    } catch(e) {
      console.log('GET failed:', e.message);
    }
  }

  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });