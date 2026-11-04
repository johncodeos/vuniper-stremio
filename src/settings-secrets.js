import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function createSettingsSecrets(key) {
  if (key.length !== 32) throw new Error('The settings encryption key must contain 32 bytes.');

  return {
    seal(settings, scope) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(scope));
      const data = Buffer.concat([cipher.update(JSON.stringify(settings)), cipher.final()]);
      return {
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      };
    },

    open({ iv, tag, data }, scope) {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAAD(Buffer.from(scope));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8'));
    },
  };
}
