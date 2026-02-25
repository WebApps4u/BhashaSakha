import crypto from 'crypto';
const getEncryptionKey = () => process.env.AI_KEY_ENCRYPTION_KEY ?? '';
const loadKey = () => {
    const raw = getEncryptionKey().trim();
    if (!raw)
        return null;
    try {
        const key = Buffer.from(raw, 'base64');
        if (key.length !== 32)
            return null;
        return key;
    }
    catch {
        return null;
    }
};
export const encryptSecret = (plaintext) => {
    const key = loadKey();
    if (!key)
        return plaintext;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = {
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: ciphertext.toString('base64'),
    };
    return `v1:${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}`;
};
export const decryptSecret = (ciphertextOrPlaintext) => {
    const key = loadKey();
    if (!key)
        return ciphertextOrPlaintext;
    const value = ciphertextOrPlaintext.trim();
    if (!value.startsWith('v1:'))
        return value;
    const b64 = value.slice('v1:'.length);
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    const iv = Buffer.from(parsed.iv ?? '', 'base64');
    const tag = Buffer.from(parsed.tag ?? '', 'base64');
    const data = Buffer.from(parsed.data ?? '', 'base64');
    if (iv.length !== 12 || tag.length !== 16)
        throw new Error('Invalid ciphertext');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    return plaintext.toString('utf8');
};
//# sourceMappingURL=cryptoVault.js.map