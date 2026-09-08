import crypto from "node:crypto";

// AES-256-GCM with the key from CREDENTIALS_KEY (64 hex characters).
// Used for the broker password so the nightly sync can log in unattended.
const key = process.env.CREDENTIALS_KEY
  ? Buffer.from(process.env.CREDENTIALS_KEY, "hex")
  : null;

export const canStoreSecrets = () => key !== null && key.length === 32;

// "iv.tag.ciphertext", each part base64.
export const encrypt = (text) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64"))
    .join(".");
};

export const decrypt = (payload) => {
  const [iv, tag, encrypted] = payload.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
};
