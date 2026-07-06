/**
 * seed-mock-data.js  (v2)
 * -----------------------
 * Seeds Firestore writebackQueue + vouchers collections with mock data.
 * Tally EDU blocks Import XML, so this script skips Tally import and
 * seeds Firestore directly — the pushEngine will read from Tally normally.
 *
 * USAGE:
 *   node seed-mock-data.js
 *
 * FIXES in v2:
 *   - Removed Tally import (EDU edition blocks it — timeout is expected)
 *   - Creates Firestore DB + both collections in one go
 *   - Adds vouchers collection so pushEngine has data to work with
 */

require('dotenv').config();
const admin = require('firebase-admin');
const crypto = require('crypto');

// ─── Firebase init ────────────────────────────────────────────────────────────
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  })
});

const db = admin.firestore();

// ─── Mock data ────────────────────────────────────────────────────────────────
const MOCK_VOUCHERS = [
  {
    partyName: 'Rajesh Traders',
    date: '2026-04-01',
    amount: 15000,
    taxAmount: 2700,
    salesLedger: 'Sales Account',
    narration: 'Invoice for laptop accessories',
    legs: [
      { ledger: 'Rajesh Traders', amount: -15000 },
      { ledger: 'Sales Account',  amount:  15000 }
    ]
  },
  {
    partyName: 'Priya Enterprises',
    date: '2026-04-05',
    amount: 28500,
    taxAmount: 5130,
    salesLedger: 'Sales Account',
    narration: 'Supply of office furniture',
    legs: [
      { ledger: 'Priya Enterprises', amount: -28500 },
      { ledger: 'Sales Account',     amount:  28500 }
    ]
  },
  {
    partyName: 'Suresh & Co',
    date: '2026-04-10',
    amount: 9200,
    taxAmount: 1656,
    salesLedger: 'Sales Account',
    narration: 'Monthly stationery supply',
    legs: [
      { ledger: 'Suresh & Co',   amount: -9200 },
      { ledger: 'Sales Account', amount:  9200 }
    ]
  },
  {
    partyName: 'Meena Distributors',
    date: '2026-04-18',
    amount: 42000,
    taxAmount: 7560,
    salesLedger: 'Sales Account',
    narration: 'Bulk order – electronic components',
    legs: [
      { ledger: 'Meena Distributors', amount: -42000 },
      { ledger: 'Sales Account',      amount:  42000 }
    ]
  },
  {
    partyName: 'Kumar Solutions',
    date: '2026-04-25',
    amount: 11750,
    taxAmount: 2115,
    salesLedger: 'Sales Account',
    narration: 'IT support services – April',
    legs: [
      { ledger: 'Kumar Solutions', amount: -11750 },
      { ledger: 'Sales Account',   amount:  11750 }
    ]
  }
];

function checksum(v) {
  return crypto
    .createHash('md5')
    .update([v.guid, v.amount, v.narration, v.date].join('|'))
    .digest('hex');
}

// ─── Seed vouchers collection (simulates what pushEngine would write) ─────────
async function seedVouchers() {
  console.log('\n📄  Seeding Firestore  →  vouchers  collection...\n');
  const batch = db.batch();

  for (const v of MOCK_VOUCHERS) {
    const guid = `MOCK-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const doc = {
      guid,
      date:        v.date,
      partyName:   v.partyName,
      amount:      String(v.amount),
      taxAmount:   String(v.taxAmount),
      narration:   v.narration,
      salesLedger: v.salesLedger,
      syncStatus:  'synced',
      legs:        v.legs,
      checksum:    checksum({ guid, amount: String(v.amount), narration: v.narration, date: v.date })
    };

    batch.set(db.collection('vouchers').doc(guid), doc);
    console.log(`  ✅  ${v.partyName.padEnd(22)}  ₹${String(v.amount).padStart(6)}  guid=${guid}`);
  }

  await batch.commit();
  console.log('\n  ✓ vouchers batch committed');
}

// ─── Seed writebackQueue collection ──────────────────────────────────────────
async function seedWritebackQueue() {
  console.log('\n🔁  Seeding Firestore  →  writebackQueue  collection...\n');
  const batch = db.batch();

  for (const v of MOCK_VOUCHERS) {
    const jobId = `job_${crypto.randomBytes(6).toString('hex')}`;
    batch.set(db.collection('writebackQueue').doc(jobId), {
      jobId,
      status:    'approved',
      createdAt: new Date().toISOString(),
      voucher: {
        partyName:   v.partyName,
        date:        v.date,
        amount:      v.amount,
        taxAmount:   v.taxAmount,
        salesLedger: v.salesLedger,
        narration:   v.narration,
        legs:        v.legs
      }
    });
    console.log(`  ✅  ${v.partyName.padEnd(22)}  ₹${String(v.amount).padStart(6)}  jobId=${jobId}`);
  }

  await batch.commit();
  console.log('\n  ✓ writebackQueue batch committed');
}

// ─── Run ──────────────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log('\n🔌  Connecting to Firestore...');
    await db.collection('_ping').doc('test').set({ ok: true });
    await db.collection('_ping').doc('test').delete();
    console.log('  ✓ Connected\n');

    await seedVouchers();
    await seedWritebackQueue();

    console.log('\n🎉  Done! Both collections seeded.\n');
    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│  Next steps                                             │');
    console.log('│  1. npm start  — run the sync agent                    │');
    console.log('│  2. Firebase Console → Firestore → check:              │');
    console.log('│       • vouchers       (5 docs, status=synced)         │');
    console.log('│       • writebackQueue (5 docs, status=approved)       │');
    console.log('└─────────────────────────────────────────────────────────┘\n');

  } catch (err) {
    console.error('\n💥  Error:', err.message);

    if (err.message.includes('NOT_FOUND')) {
      console.error('\n👉  Firestore database does not exist yet.');
      console.error('    Fix: Go to https://console.firebase.google.com');
      console.error('    → your project → Firestore Database → Create database');
      console.error('    Choose "Start in test mode" then pick any region.\n');
    }

    if (err.message.includes('PERMISSION_DENIED')) {
      console.error('\n👉  Firestore API is not enabled.');
      console.error('    Fix: Visit the URL in the error above and click Enable.\n');
    }
  } finally {
    process.exit(0);
  }
})();