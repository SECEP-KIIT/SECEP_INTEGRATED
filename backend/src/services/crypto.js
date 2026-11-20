// The shared secret format (SRS §6.6, NFR-SEC-001): base64(nonce 12 ‖ ciphertext ‖ tag 16), AES-256-GCM under the
// master key (DC-10). Used for mailbox refresh tokens, Jira/LLM keys and masked originals.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

let key = null;
function masterKey() {
  if (key) return key;
  const raw = config.masterKey;
  // 32 bytes as hex or base64; anything else is hashed to 32 bytes (dev convenience, never weaker than its input).
  key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64').length === 32 ? Buffer.from(raw, 'base64') : createHash('sha256').update(raw).digest();
  return key;
}

export function encrypt(plain) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), nonce);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64');
}

export function decrypt(enc) {
  const buf = Buffer.from(enc, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([decipher.update(buf.subarray(12, buf.length - 16)), decipher.final()]).toString('utf8');
}
