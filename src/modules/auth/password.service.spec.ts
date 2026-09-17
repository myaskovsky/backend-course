import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes a password to an argon2id string that verifies', async () => {
    const hash = await service.hash('password123');

    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(service.verify(hash, 'password123')).resolves.toBe(true);
  });

  it('returns false for a wrong password', async () => {
    const hash = await service.hash('password123');

    await expect(service.verify(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('returns false (does not throw) for a malformed hash', async () => {
    await expect(service.verify('not-a-hash', 'password123')).resolves.toBe(
      false,
    );
  });
});
