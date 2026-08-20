const crypto = require('crypto');

let _loginLogsKey = null;
let _legacyLoginLogsKey = null;

function getLoginLogsKey() {
  if (!_loginLogsKey) {
    const secret = process.env.LOG_ENCRYPTION_SECRET;
    if (!secret) throw new Error('LOG_ENCRYPTION_SECRET no está configurado');
    _loginLogsKey = Buffer.from(crypto.hkdfSync(
      'sha256',
      Buffer.from(secret),
      Buffer.alloc(0),
      'synnox:login-logs:v1',
      32
    ));
  }
  return _loginLogsKey;
}

function getLegacyLoginLogsKey() {
  if (!_legacyLoginLogsKey) {
    // Existing CBC records were derived from JWT_SECRET and must remain readable.
    _legacyLoginLogsKey = crypto.scryptSync(process.env.JWT_SECRET, 'login-logs', 32);
  }
  return _legacyLoginLogsKey;
}

function encryptEmail(email) {
  const key = getLoginLogsKey();
  // GCM requires a fresh IV for every operation; 12 bytes is the recommended size.
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(email, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `gcm:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptEmail(data) {
  if (data.startsWith('gcm:')) {
    const [, ivHex, tagHex, encryptedHex] = data.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getLoginLogsKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, 'hex')),
      decipher.final()
    ]).toString('utf8');
  }

  // Legacy format: iv:ciphertext encrypted with AES-256-CBC and JWT_SECRET.
  const [ivHex, ...encryptedParts] = data.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    getLegacyLoginLogsKey(),
    Buffer.from(ivHex, 'hex')
  );
  let dec = decipher.update(encryptedParts.join(':'), 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

module.exports = { encryptEmail, decryptEmail };
