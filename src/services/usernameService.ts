import { QueryRunner } from 'typeorm';

/**
 * Generates a unique username based on the user's name.
 * 1. Take the user's first name, lowercase it, strip non-alphanumeric characters
 * 2. Append a random 4-digit number: e.g. pelumi4821
 * 3. Check if it already exists in the database
 * 4. If it does, regenerate with a new random number and retry up to 10 times
 * 5. If all 10 attempts collide, fall back to user + 8 random digits: user48291034
 */
export async function generateUsername(name: string, qr: QueryRunner): Promise<string> {
  const firstName = name.split(' ')[0] || 'user';
  const baseName = firstName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeBaseName = baseName.length > 0 ? baseName : 'user';

  for (let i = 0; i < 10; i++) {
    const random4 = Math.floor(1000 + Math.random() * 9000).toString(); // 4 digits
    const candidate = `${safeBaseName}${random4}`.substring(0, 30);

    const exists = await qr.query(`SELECT 1 FROM "users" WHERE "username" = $1 LIMIT 1`, [candidate]);
    
    if (exists.length === 0) {
      return candidate;
    }
  }

  // Fallback after 10 collisions
  const random8 = Math.floor(10000000 + Math.random() * 90000000).toString(); // 8 digits
  return `user${random8}`.substring(0, 30);
}