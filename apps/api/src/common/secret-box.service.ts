import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM for secrets stored in the database (payment keys). The key comes from
 * SETTINGS_ENCRYPTION_KEY (32 bytes, base64) and must never change once secrets are saved.
 * Output format: v1:<iv>:<tag>:<ciphertext>, all base64.
 */
@Injectable()
export class SecretBoxService {
  constructor(private readonly config: ConfigService) {}

  get available() {
    return Boolean(this.config.get('SETTINGS_ENCRYPTION_KEY'));
  }

  seal(plain: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
  }

  open(sealed: string) {
    const [version, iv, tag, data] = sealed.split(':');
    if (version !== 'v1') throw new Error('Unknown secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }

  private key() {
    const raw = this.config.get<string>('SETTINGS_ENCRYPTION_KEY');
    if (!raw) throw new ServiceUnavailableException('SETTINGS_ENCRYPTION_KEY is not set on the server');
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new ServiceUnavailableException('SETTINGS_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
    return key;
  }
}
