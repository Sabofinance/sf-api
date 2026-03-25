import request from 'supertest';

import { app, MIN_VALID_PNG, registerAndLogin } from './helpers';

describe('KYC', () => {
  it('returns kyc status for user', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app).get('/kyc/status').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.kyc_status).toBeTruthy();
  });

  it('uploads kyc (skipped when Cloudinary not configured)', async () => {
    if (!process.env.CLOUDINARY_URL) return;
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .post('/kyc/upload')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('document_type', 'passport')
      .attach('document', MIN_VALID_PNG, { filename: 'doc.png', contentType: 'image/png' })
      .attach('selfie', MIN_VALID_PNG, { filename: 'selfie.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.data.kyc.status).toBe('pending');
  });
});

