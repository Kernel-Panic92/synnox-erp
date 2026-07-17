const crypto = require('crypto');

function encryptEmail(email) {
  const key = crypto.scryptSync(process.env.JWT_SECRET, 'login-logs', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let enc = cipher.update(email, 'utf8', 'hex');
  enc += cipher.final('hex');
  return iv.toString('hex') + ':' + enc;
}

function decryptEmail(data) {
  const parts = data.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encrypted = parts.join(':');
  const key = crypto.scryptSync(process.env.JWT_SECRET, 'login-logs', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let dec = decipher.update(encrypted, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

module.exports = { encryptEmail, decryptEmail };
