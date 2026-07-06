const express  = require('express');
const path     = require('path');
const crypto   = require('crypto');

const leveldb      = require('./leveldb');
const firestore    = require('./firestore');
const tallyClient  = require('./tallyClient');
const normalise    = require('./normalise');
const logger       = require('./logger');

const app = express();
app.use(express.json());

// ─── Serve dashboard HTML ─────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ─── GET /api/status ──────────────────────────────────────────────────────────
app.get('/api/status', async (_req, res) => {
  try {
    const [tallyReachable, items] = await Promise.all([
      tallyClient.healthCheck(),
      leveldb.getByPrefix('voucher:'),
    ]);

    const vouchers = items.map(i => i.value);
    res.json({
      tallyReachable,
      total:   vouchers.length,
      synced:  vouchers.filter(v => v.syncStatus === 'synced').length,
      pending: vouchers.filter(v => v.syncStatus === 'pending').length,
      error:   vouchers.filter(v => v.syncStatus === 'error').length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/vouchers ────────────────────────────────────────────────────────
app.get('/api/vouchers', async (_req, res) => {
  try {
    const items = await leveldb.getByPrefix('voucher:');
    res.json(items.map(i => i.value));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/vouchers — create & push to Firestore + writeback queue ────────
//
// FIX: Admin-created vouchers now also go into the `writebackQueue` collection
// so the writeback engine will push them into Tally automatically.
//
app.post('/api/vouchers', async (req, res) => {
  try {
    const { partyName, amount, date, narration, salesLedger, legs } = req.body;

    if (!partyName || !amount || !date) {
      return res.status(400).json({ error: 'partyName, amount and date are required' });
    }

    if (!salesLedger && (!legs || legs.length < 2)) {
      return res.status(400).json({
        error: 'salesLedger is required (or provide explicit legs[] with at least 2 entries)'
      });
    }

    const guid = crypto
      .createHash('md5')
      .update([date, partyName, amount, Date.now()].join('|'))
      .digest('hex');

    const voucher = normalise({ guid, date, partyName, amount, narration, salesLedger, legs: legs || [] });
    voucher.syncStatus = 'pending';
    await leveldb.set(`voucher:${guid}`, voucher);

    // 1. Push to Firestore vouchers collection (for display / read side)
    await firestore.collection('vouchers').doc(guid).set(voucher, { merge: true });
    voucher.syncStatus = 'synced';
    await leveldb.set(`voucher:${guid}`, voucher);

    // 2. Enqueue into writebackQueue (Firestore + LevelDB) so writeback engine pushes to Tally
    const jobId = `admin-${guid}`;
    const jobVoucher = {
      guid,
      date,
      partyName,
      amount: String(amount),
      narration: narration || '',
      salesLedger: salesLedger || '',
      legs: legs || []
    };
    const job = {
      jobId,
      status: 'approved',
      source: 'admin',
      createdAt: new Date().toISOString(),
      voucher: jobVoucher
    };

    // Write to LevelDB as 'pending' immediately — writeback engine picks this up
    // without needing a Firestore round-trip (avoids the timing race on fast cycles)
    await leveldb.set(`queue:${jobId}`, { ...job, status: 'pending', retryCount: 0 });

    // Also persist to Firestore for durability and visibility
    await firestore.collection('writebackQueue').doc(jobId).set(job);

    logger.info(`Admin created voucher → ${partyName} ₹${amount} — queued for Tally writeback`);
    res.status(201).json(voucher);
  } catch (err) {
    logger.error(`Admin create error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/vouchers/:guid — edit fields → Firestore ─────────────────────
app.patch('/api/vouchers/:guid', async (req, res) => {
  try {
    const { guid } = req.params;
    const key      = `voucher:${guid}`;
    const existing = await leveldb.get(key);

    if (!existing) return res.status(404).json({ error: 'Voucher not found' });

    const merged  = { ...existing, ...req.body, guid };
    const updated = normalise(merged);
    updated.syncStatus = 'pending';
    await leveldb.set(key, updated);

    await firestore.collection('vouchers').doc(guid).set(updated, { merge: true });
    updated.syncStatus = 'synced';
    await leveldb.set(key, updated);

    // ✅ NEW: enqueue edited voucher for Tally writeback
    const jobId = `patch-${guid}`;
    const job = {
      jobId,
      status: 'approved',
      source: 'admin-patch',
      createdAt: new Date().toISOString(),
      voucher: {
        guid,
        date:        updated.date,
        partyName:   updated.partyName,
        amount:      updated.amount,
        narration:   updated.narration || '',
        salesLedger: updated.salesLedger || '',
        legs:        updated.legs || []
      }
    };
    await leveldb.set(`queue:${jobId}`, { ...job, status: 'pending', retryCount: 0 });
    await firestore.collection('writebackQueue').doc(jobId).set(job);

    logger.info(`Admin updated voucher ${guid.slice(0, 8)} → ${updated.partyName} ₹${updated.amount}`);
    res.json(updated);
  } catch (err) {
    logger.error(`Admin edit error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/vouchers/:guid/tally — push this voucher to Tally immediately ──
app.post('/api/vouchers/:guid/tally', async (req, res) => {
  try {
    const { guid } = req.params;
    const voucher  = await leveldb.get(`voucher:${guid}`);

    if (!voucher) return res.status(404).json({ error: 'Voucher not found' });

    const healthy = await tallyClient.healthCheck();
    if (!healthy) return res.status(503).json({ error: 'Tally is not reachable — make sure Tally is open' });

    await tallyClient.writeVoucherToTally(voucher);
    logger.info(`Admin pushed voucher ${guid.slice(0, 8)} → Tally`);
    res.json({ success: true, message: 'Voucher written to Tally' });
  } catch (err) {
    logger.error(`Admin Tally push error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/queue — show writeback queue status ────────────────────────────
app.get('/api/queue', async (_req, res) => {
  try {
    const items = await leveldb.getByPrefix('queue:');
    const jobs = items.map(i => {
      const j = i.value;
      return {
        jobId:      j.jobId,
        status:     j.status,
        source:     j.source || 'firestore',
        partyName:  j.voucher?.partyName,
        amount:     j.voucher?.amount,
        date:       j.voucher?.date,
        retryCount: j.retryCount || 0,
        syncedAt:   j.syncedAt || null,
        nextRetryAt:j.nextRetryAt || null,
        errorMessage: j.errorMessage
          ? j.errorMessage.replace(/<[^>]+>/g, '').trim().slice(0, 200)
          : null
      };
    });
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/sync — manually trigger a full Tally→Firestore cycle ───────────
app.post('/api/sync', async (_req, res) => {
  try {
    const pushEngine = require('./pushEngine');
    await pushEngine();
    logger.info('Admin triggered manual sync');
    res.json({ success: true, message: 'Sync cycle complete' });
  } catch (err) {
    logger.error(`Admin sync error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/writeback — manually trigger writeback cycle ──────────────────
app.post('/api/writeback', async (_req, res) => {
  try {
    const writebackEngine = require('./writebackEngine');
    await writebackEngine();
    logger.info('Admin triggered manual writeback');
    res.json({ success: true, message: 'Writeback cycle complete — check logs and /api/queue' });
  } catch (err) {
    logger.error(`Admin writeback error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/vouchers/:guid ───────────────────────────────────────────────
app.delete('/api/vouchers/:guid', async (req, res) => {
  try {
    const { guid }    = req.params;
    const fromFirestore = req.query.firestore === 'true';

    await leveldb.del(`voucher:${guid}`);

    if (fromFirestore) {
      await firestore.collection('vouchers').doc(guid).delete();
      logger.info(`Admin deleted voucher ${guid.slice(0, 8)} from LevelDB + Firestore`);
    } else {
      logger.info(`Admin deleted voucher ${guid.slice(0, 8)} from LevelDB`);
    }

    res.json({ success: true });
  } catch (err) {
    logger.error(`Admin delete error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
function startAdminServer(port = 3001) {
  app.listen(port, () => {
    logger.info(`✦ Admin dashboard → http://localhost:${port}`);
  });
}

module.exports = startAdminServer;
