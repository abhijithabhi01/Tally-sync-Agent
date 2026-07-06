const db = require('./firestore');
const logger = require('./logger');
const leveldb = require('./leveldb');
const normalise = require('./normalise');
const tallyClient = require('./tallyClient');

function nextRetryDelay(retryCount) {
  return Math.pow(2, retryCount) * 60000;
}

function validateVoucher(voucher) {
  if (!voucher.partyName) throw new Error('partyName missing');
  if (Number(voucher.amount) <= 0) throw new Error('amount invalid');
  if (!voucher.date) throw new Error('date missing');
  // Allow empty salesLedger — tallyClient falls back to DEFAULT_SALES_LEDGER env var
  const hasLegs = Array.isArray(voucher.legs) && voucher.legs.length >= 2;
  const hasSalesLedger = voucher.salesLedger && voucher.salesLedger.trim();
  const hasDefault = !!process.env.DEFAULT_SALES_LEDGER;
  console.log('----------------->>>>>>>>',hasDefault)
  if (!hasLegs && !hasSalesLedger && !hasDefault) {
    throw new Error('salesLedger missing and no DEFAULT_SALES_LEDGER set in .env');
  }
}

async function syncFirestoreQueue() {
  // Pick up jobs with status 'approved' OR 'pending' from Firestore
  // (covers both: new jobs approved via external admin, and jobs that were pending before restart)
  const approvedSnap = await db.collection('writebackQueue')
    .where('status', 'in', ['approved', 'pending']).limit(20).get();
  const docs = approvedSnap.docs;
  let queued = 0;

  for (const doc of docs) {
    const data = doc.data();
    const existing = await leveldb.get(`queue:${data.jobId}`);

    if (!existing) {
      await leveldb.set(`queue:${data.jobId}`, {
        ...data,
        status: 'pending',
        retryCount: data.retryCount || 0
      });
      queued++;
      logger.info(`Writeback queue: picked up job ${data.jobId} (${data.voucher?.partyName})`);
    }
  }

  if (queued === 0) {
    logger.info('Writeback queue: no new approved jobs from Firestore');
  }
}

async function processQueue() {
  const jobs = await leveldb.getByPrefix('queue:');
  const pending = jobs.filter(j => {
    if (j.value.status !== 'pending') return false;
    // Respect retry cooldown
    if (j.value.nextRetryAt && new Date(j.value.nextRetryAt) > new Date()) return false;
    return true;
  });

  if (pending.length === 0) {
    logger.info('Writeback queue: nothing pending');
    return;
  }

  logger.info(`Writeback queue: processing ${pending.length} pending job(s)`);

  for (const item of pending) {
    const job = item.value;

    try {
      validateVoucher(job.voucher);
      const voucher = normalise(job.voucher);

      logger.info(`Writeback → Tally: ${voucher.partyName} ₹${voucher.amount} (${voucher.date})`);
      await tallyClient.writeVoucherToTally(voucher);

      job.status = 'synced';
      job.syncedAt = new Date().toISOString();
      job.errorMessage = null;

      await leveldb.set(item.key, job);
      await db.collection('writebackQueue').doc(job.jobId).set(job, { merge: true });

      logger.info(`✅ Writeback SUCCESS → Tally: ${voucher.partyName} ₹${voucher.amount} written to Tally`);

    } catch (err) {
      job.retryCount = (job.retryCount || 0) + 1;
      job.errorMessage = err.message;

      // Strip verbose Tally XML from logs — extract just the LINEERROR
      // Replace the lineErr extraction in the catch block:
      const lineErr = err.message.match(/<LINEERROR>([^<]+)<\/LINEERROR>/);
      const exceptErr = err.message.includes('<EXCEPTIONS>1</EXCEPTIONS>')
        ? 'Tally rejected the voucher (no LINEERROR — likely a missing ledger name in Tally masters)'
        : null;
      const shortErr = lineErr ? lineErr[1] : (exceptErr || err.message.slice(0, 200));
      if (job.retryCount >= 5) {
        job.status = 'dead';
        logger.error(`❌ Writeback DEAD (5 retries exhausted): ${job.voucher?.partyName} — ${shortErr}`);
      } else {
        job.status = 'pending';
        job.nextRetryAt = new Date(Date.now() + nextRetryDelay(job.retryCount)).toISOString();
        logger.error(`❌ Writeback FAILED (retry ${job.retryCount}/5): ${job.voucher?.partyName} — ${shortErr}`);
        logger.info(`   Next retry at: ${job.nextRetryAt}`);
      }

      await leveldb.set(item.key, job);
      await db.collection('writebackQueue').doc(job.jobId).set(job, { merge: true });
    }
  }
}

async function writebackEngine() {
  try {
    logger.info('--- Writeback cycle start ---');
    await syncFirestoreQueue();
    await processQueue();
    await leveldb.set('state:lastWriteback', new Date().toISOString());
    logger.info('--- Writeback cycle done ---');
  } catch (err) {
    logger.error(`Writeback engine error: ${err.message}`);
  }
}

module.exports = writebackEngine;
