const db = require('./firestore');
const logger = require('./logger');
const normalise = require('./normalise');
const tallyClient = require('./tallyClient');
const leveldb = require('./leveldb');
const crypto = require('crypto');

async function pushToFirestore() {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Always fetch from start of Indian financial year so no vouchers are missed.
    // (Previously was set to "today" each run which caused 0 results on next cycle)
    const FROM_DATE = '2026-04-01';

    logger.info(`Fetching Tally vouchers from ${FROM_DATE} to ${today}`);

    const vouchers = await tallyClient.fetchSalesVouchers(FROM_DATE, today);

    logger.info(`Tally returned ${vouchers.length} Sales voucher(s)`);

    if (vouchers.length === 0) {
      logger.warn('No Sales vouchers found — make sure at least one Sales voucher exists in Tally');
    }

    let newCount = 0;

    for (const rawVoucher of vouchers) {
      // Generate stable GUID if Tally EDU doesn't provide one
      const guid = rawVoucher.GUID ||
        crypto.createHash('md5')
          .update([rawVoucher.DATE, rawVoucher.PARTYNAME, rawVoucher.AMOUNT].join('|'))
          .digest('hex');

      const voucher = normalise({
        guid,
        date:      rawVoucher.DATE,
        partyName: rawVoucher.PARTYNAME,
        amount:    rawVoucher.AMOUNT,
        narration: rawVoucher.NARRATION
      });

      if (!voucher.date) {
        logger.warn('Skipping voucher with no date');
        continue;
      }

      const key = `voucher:${voucher.guid}`;
      const existing = await leveldb.get(key);

      if (!existing || existing.checksum !== voucher.checksum) {
        voucher.syncStatus = 'pending';
        await leveldb.set(key, voucher);
        newCount++;
        logger.info(`Buffered → ${voucher.partyName} ₹${voucher.amount} (${voucher.date})`);
      }
    }

    logger.info(`${newCount} new/changed voucher(s) buffered to LevelDB`);

    // Push all pending → Firestore
    const pending = await leveldb.getByPrefix('voucher:');
    let synced = 0;
    let errors = 0;

    for (const item of pending) {
      const voucher = item.value;
      if (voucher.syncStatus !== 'pending') continue;

      try {
        await db.collection('vouchers').doc(voucher.guid).set(voucher, { merge: true });
        voucher.syncStatus = 'synced';
        await leveldb.set(item.key, voucher);
        synced++;
        logger.info(`✅ Firestore ← ${voucher.partyName} ₹${voucher.amount}`);
      } catch (err) {
        voucher.syncStatus = 'error';
        await leveldb.set(item.key, voucher);
        errors++;
        logger.error(`Firestore push failed for ${voucher.partyName}: ${err.message}`);
      }
    }

    logger.info(`Push cycle done — synced: ${synced}, errors: ${errors}`);

  } catch (err) {
    logger.error(`Push cycle failed: ${err.message}`);
  }
}

module.exports = pushToFirestore;