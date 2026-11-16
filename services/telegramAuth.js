const crypto = require('crypto');

function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) {
    return { valid: false, reason: 'missing_params' };
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) {
      return { valid: false, reason: 'missing_hash' };
    }

    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      return { valid: false, reason: 'invalid_hash' };
    }

    const userRaw = params.get('user');
    const user = userRaw ? JSON.parse(userRaw) : null;
    return { valid: true, user };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

module.exports = {
  verifyTelegramInitData,
};
