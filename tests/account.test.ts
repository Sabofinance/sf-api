import request from 'supertest';

import { createApp } from '../src/app';

import { registerAndLogin } from './helpers';

const app = createApp();

describe('Account Endpoints', () => {
  describe('PUT /account/username', () => {
    it('changes the username successfully', async () => {
      const user = await registerAndLogin();
      
      const res = await request(app)
        .put('/account/username')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ username: 'new_custom_name123' });

      console.log('RES.BODY:', JSON.stringify(res.body, null, 2));

      expect(res.status).toBe(200);
      expect(res.body.data.user.username).toBe('new_custom_name123');
    });

    it('returns 409 if username is already taken', async () => {
      const user1 = await registerAndLogin();
      const user2 = await registerAndLogin();

      // Get user1's auto-generated username
      const meRes = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${user1.accessToken}`);
      const user1Name = meRes.body.data.user.username;

      // Try to set user2's username to user1's username
      const res = await request(app)
        .put('/account/username')
        .set('Authorization', `Bearer ${user2.accessToken}`)
        .send({ username: user1Name });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('USERNAME_TAKEN');
    });

    it('returns 400 for invalid username formats', async () => {
      const user = await registerAndLogin();
      
      const res1 = await request(app)
        .put('/account/username')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ username: 'a' }); // Too short
      expect(res1.status).toBe(400);

      const res2 = await request(app)
        .put('/account/username')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ username: 'invalid name!' }); // Spaces/special chars
      expect(res2.status).toBe(400);
    });

    it('returns 401 if unauthenticated', async () => {
      const res = await request(app)
        .put('/account/username')
        .send({ username: 'testname' });

      expect(res.status).toBe(401);
    });
  });
});