'use strict';
const crypto = require('crypto');

/** Huella de lo que ofrece una página/repo: versión + descargables compatibles. Cambia cuando sale algo nuevo. */
function signature(res) {
  const parts = res.assets.filter((a) => a.compatible).map((a) => `${a.name}#${a.rev || a.size || ''}`).sort();
  return crypto.createHash('sha1').update([res.version || '', ...parts].join('\n')).digest('hex').slice(0, 16);
}

const watchId = (input) => crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, 12);

module.exports = { signature, watchId };
