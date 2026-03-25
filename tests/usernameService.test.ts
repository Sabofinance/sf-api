import { generateUsername } from '../src/services/usernameService';

describe('Username Service', () => {
  it('generates a valid username from a name', async () => {
    const qrMock = {
      query: jest.fn().mockResolvedValue([]),
    } as any;

    const username = await generateUsername('Pelumi', qrMock);
    expect(username).toMatch(/^pelumi\d{4}$/);
    expect(qrMock.query).toHaveBeenCalledTimes(1);
  });

  it('strips special characters and spaces', async () => {
    const qrMock = {
      query: jest.fn().mockResolvedValue([]),
    } as any;

    const username = await generateUsername('O\'Neil!@#', qrMock);
    expect(username).toMatch(/^oneil\d{4}$/);
  });

  it('handles collisions by retrying', async () => {
    // Mock: first call returns a row (collision), second call returns empty (available)
    const qrMock = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: '123' }])
        .mockResolvedValueOnce([]),
    } as any;

    const username = await generateUsername('Pelumi', qrMock);
    expect(username).toMatch(/^pelumi\d{4}$/);
    expect(qrMock.query).toHaveBeenCalledTimes(2);
  });

  it('falls back to user+8digits after 10 collisions', async () => {
    // Mock: always return collision
    const qrMock = {
      query: jest.fn().mockResolvedValue([{ id: '123' }]),
    } as any;

    const username = await generateUsername('Pelumi', qrMock);
    expect(username).toMatch(/^user\d{8}$/);
    expect(qrMock.query).toHaveBeenCalledTimes(10);
  });
});