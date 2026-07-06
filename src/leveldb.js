const { Level } = require('level');

const db = new Level('./agent-db', {
  valueEncoding: 'json'
});

async function get(key) {
  try {
    return await db.get(key);
  } catch (err) {
    if (err.code === 'LEVEL_NOT_FOUND') return null;
    throw err;
  }
}

async function set(key, value) {
  return db.put(key, value);
}

async function del(key) {
  return db.del(key);
}

async function getByPrefix(prefix) {
  const items = [];

  for await (const [key, value] of db.iterator({
    gte: prefix,
    lt: prefix + '\xFF'
  })) {
    items.push({ key, value });
  }

  return items;
}

module.exports = {
  db,
  get,
  set,
  del,
  getByPrefix
};