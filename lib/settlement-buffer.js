import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

const PATH = '/internal/settlement-evidence';
// Domain separation: never transmit the existing facilitator credential. These
// services already share it; this read-only relay introduces no new stored key.
export function deriveRelayKey(secret, host = 'chainverdict.xyz') {
  return secret ? Buffer.from(hkdfSync('sha256', secret, 'chainverdict-relay', 'v1:' + host, 32)) : null;
}
export function relaySignature(key, timestamp, host = 'chainverdict.xyz') {
  return createHmac('sha256', key).update(`chainverdict.settlement-read.v1\n${timestamp}\nGET\n${host}\n${PATH}`).digest('hex');
}
export function authenticatedRelay(req, key, now = Date.now(), host = 'chainverdict.xyz') {
  const timestamp = req.get('x-cv-time') || '';
  const supplied = req.get('x-cv-signature') || '';
  if (!key || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 60000 || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(relaySignature(key, timestamp, host), 'hex'));
}
export function settlementBuffer({ secret = process.env.CDP_API_KEY_SECRET, host = 'chainverdict.xyz', capacity = 2000, now = () => new Date().toISOString() } = {}) {
  const key = deriveRelayKey(secret, host);
  const startedAt = now(), records = [];
  let dropped = 0, minute = 0, calls = 0;
  return {
    add(record) { records.push(record); if (records.length > capacity) { records.shift(); dropped++; } },
    install(app) {
      app.get(PATH, (req, res) => {
        res.set('Cache-Control', 'no-store');
        const current = Math.floor(Date.now() / 60000);
        if (current !== minute) { minute = current; calls = 0; }
        if (req.method !== 'GET' || !authenticatedRelay(req, key, Date.now(), host)) {
          return res.status(++calls > 120 ? 429 : 404).end();
        }
        return res.json({ schema: 'chainverdict.settlement-buffer.v1', startedAt, dropped, records });
      });
    },
  };
}
