import crypto from 'crypto';

import bcrypt from 'bcrypt';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import passport from 'passport';
import { Strategy as GoogleStrategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import { env } from '../../config/env';
import { withTransaction } from '../../database/transaction';
import { sendEmail } from '../../services/emailService';
import { NotificationService } from '../../services/notificationService';
import { generateUsername } from '../../services/usernameService';
import { created, ok } from '../../utils/apiResponse';
import { Currency, UserRole, NotificationType } from '../../utils/enums';
import { AppError, UnauthorizedError } from '../../utils/errors';



const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(7).max(32),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

function signAccessToken(user: { id: string; name: string; email: string; role: UserRole; kyc_status: string }) {
  const payload = { id: user.id, name: user.name, email: user.email, role: user.role, kyc_status: user.kyc_status };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '30m' });
}

function signRefreshToken(user: { id: string; name: string; email: string; role: UserRole; kyc_status: string }) {
  const payload = { id: user.id, name: user.name, email: user.email, role: user.role, kyc_status: user.kyc_status };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
}


/**
 * @swagger
 * /auth/google:
 *   get:
 *     summary: Initiate Google OAuth login/signup
 *     tags: [Auth]
 *     description: Redirects the user to Google for authentication. Supports both new users (signup) and existing users (login).
 *     responses:
 *       302:
 *         description: Redirect to Google login page
 */
export function googleInitiate(req: Request, res: Response) {
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account', // Optional: forces account selection (good UX)
  })(req, res);
}

// ====================== GOOGLE PASSPORT STRATEGY ======================
passport.use(
  new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID!,           // ← Use env, not process.env
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
      callbackURL: `${env.API_BASE_URL}/auth/google/callback`,
      scope: ['profile', 'email'],
    },
    async (
      accessToken: string,
      refreshToken: string,
      profile: Profile,
      done: VerifyCallback
    ) => {
      try {
        const email = profile.emails?.[0]?.value?.toLowerCase();
        const name = profile.displayName ||
          `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim();
        const picture = profile.photos?.[0]?.value;

        if (!email) {
          return done(new Error('Google did not provide an email'));
        }

        const result = await withTransaction(async (qr) => {
          // Check if user exists
          const existingRows = (await qr.query(
            `SELECT "id", "email_verified", "profile_picture_url", "name" 
             FROM "users" WHERE "email" = $1`,
            [email]
          )) as Array<{ id: string; email_verified: boolean; profile_picture_url?: string; name?: string }>;

          if (existingRows.length > 0) {
            const existing = existingRows[0];

            // Auto-verify email + optionally update profile picture and name
            let updateQuery = `UPDATE "users" SET "email_verified" = true`;
            const params: any[] = [existing.id];

            if (picture && existing.profile_picture_url !== picture) {
              updateQuery += `, "profile_picture_url" = $${params.length + 1}`;
              params.push(picture);
            }
            if (name && existing.name !== name) {
              updateQuery += `, "name" = $${params.length + 1}`;
              params.push(name);
            }

            updateQuery += ` WHERE "id" = $1`;

            await qr.query(updateQuery, params);

            return {
              id: existing.id,
              name: name || existing.name,
              email,
              role: UserRole.user,
              kyc_status: 'unverified', // or fetch real value
              email_verified: true
            };
          }

          // === New User Creation ===
          const username = await generateUsername(name, qr);
          const dummyPasswordHash = await bcrypt.hash('google-oauth-no-password', 12);

          const rows = (await qr.query(
            `INSERT INTO "users" (
              "id", "name", "username", "email", "phone", "password_hash",
              "email_verified", "phone_verified", "kyc_status", "role",
              "is_suspended", "profile_picture_url", "created_at"
            ) VALUES (
              gen_random_uuid(), $1, $2, $3, NULL, $4,
              true, false, 'unverified', $5,
              false, $6, now()
            )
            RETURNING "id", "name", "username", "email", "email_verified", 
                      "kyc_status", "role", "profile_picture_url"`,
            [name, username, email, dummyPasswordHash, UserRole.user, picture || null]
          )) as any[];

          const newUser = rows[0];

          // Create wallets
          const currencies = [Currency.NGN, Currency.GBP, Currency.USD, Currency.CAD] as const;
          for (const currency of currencies) {
            await qr.query(
              `INSERT INTO "wallets" ("id","user_id","currency","balance","locked_balance","updated_at")
               VALUES (gen_random_uuid(), $1, $2, 0, 0, now())`,
              [newUser.id, currency]
            );
          }

          // Welcome notification
          const notificationService = new NotificationService();
          await notificationService.createNotification({
            queryRunner: qr,
            userId: newUser.id,
            title: 'Welcome to Sabo Finance',
            message: 'Your account has been successfully created via Google!',
            type: NotificationType.success,
          });

          return {
            ...newUser,
            role: UserRole.user,
            kyc_status: 'unverified'
          };
        });

        return done(null, result);
      } catch (err: any) {
        console.error('Google Strategy Error:', err);
        return done(err);
      }
    }
  )
);



/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, phone, password]
 *             properties:
 *               name: { type: string, example: "Jane Doe" }
 *               email: { type: string, example: "jane@example.com" }
 *               phone: { type: string, example: "+2348000000000" }
 *               password: { type: string, example: "Password123!" }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiErrorEnvelope" }
 */
export async function register(req: Request, res: Response) {
  const input = registerSchema.parse(req.body);
  const password_hash = await bcrypt.hash(input.password, 12);

  const result = await withTransaction(async (qr) => {
    const username = await generateUsername(input.name, qr);

    const rows = (await qr.query(
      `INSERT INTO "users" ("id","name","username","email","phone","password_hash","email_verified","phone_verified","kyc_status","role","is_suspended","created_at")
       VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,false,false,'unverified',$6,false, now())
       RETURNING "id","name","username","email","phone","email_verified","phone_verified","kyc_status","role","profile_picture_url","is_suspended","created_at"`,
      [input.name, username, input.email.toLowerCase(), input.phone, password_hash, UserRole.user],
    )) as Array<Record<string, unknown>>;

    const user = rows[0] as { id: string; role: UserRole; kyc_status: string };
    const currencies = [Currency.NGN, Currency.GBP, Currency.USD, Currency.CAD] as const;
    for (const currency of currencies) {
      await qr.query(
        `INSERT INTO "wallets" ("id","user_id","currency","balance","locked_balance","updated_at")
         VALUES (gen_random_uuid(), $1,$2,0,0, now())`,
        [user.id, currency],
      );
    }

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: user.id,
      title: 'Welcome to Sabo Finance',
      message: 'Your account has been successfully created. Please verify your email to get started.',
      type: NotificationType.success,
    });

    return rows[0];
  });

  const user = result as unknown as { id: string; name: string; username: string; email: string; role: UserRole; kyc_status: string };

  // Send verification email
  const verificationToken = jwt.sign({ id: user.id, email: user.email, purpose: 'verify-email' }, env.JWT_SECRET, { expiresIn: '1h' });
  const verificationBaseUrl = env.WEBSITE_URL ?? 'http://localhost:5173';
  const verificationLink = `${verificationBaseUrl}/verify-email?token=${encodeURIComponent(verificationToken)}`;
  await sendEmail({
    to: user.email,
    subject: 'Verify Your Email Address',
    template: 'email-verification',
    context: { name: user.name, verificationLink },
  });
  const websiteUrl = env.WEBSITE_URL ?? 'https://sabofinance.com';
  await sendEmail({
    to: user.email,
    subject: 'Welcome to Sabo Finance — your seat at the table is ready',
    template: 'welcome',
    context: {
      name: user.name,
      learnLink: `${websiteUrl}/learn`,
      profileLink: `${websiteUrl}/settings/profile`,
      helpCenterLink: env.HELP_CENTER_URL ?? `${websiteUrl}/help`,
      contactLink: env.CONTACT_URL ?? `${websiteUrl}/contact`,
    },
  });

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  return created(res, { user, tokens: { accessToken, refreshToken } });
}



const googleSignupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  picture: z.string().url(),
});

/**
 * @swagger
 * /auth/google-signup:
 *   post:
 *     summary: Google signup
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, name, picture]
 *             properties:
 *               email: { type: string, example: "jane@example.com" }
 *               name: { type: string, example: "Jane Doe" }
 *               picture: { type: string, example: "https://example.com/picture.jpg" }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiErrorEnvelope" }
 */
export async function googleSignup(req: Request, res: Response) {
  const input = googleSignupSchema.parse(req.body);

  const result = await withTransaction(async (qr) => {
    // 1. Check if user already exists
    const existingRows = (await qr.query(
      `SELECT "id","email_verified" FROM "users" WHERE "email" = $1`,
      [input.email.toLowerCase()]
    )) as Array<Record<string, unknown>>;



    // Inside the transaction, after checking existing user:
    if (existingRows.length > 0) {
      throw new Error('An account with this email already exists. Please login instead.');
    }

    if (existingRows.length > 0) {
      const existing = existingRows[0] as { id: string; email_verified: boolean };
      // Optionally auto-verify email if not already
      if (!existing.email_verified) {
        await qr.query(
          `UPDATE "users" SET "email_verified" = true WHERE "id" = $1`,
          [existing.id]
        );
      }

      // You can return the existing user here or throw a specific error
      // For pure "signup" endpoint, you might want to return 409 Conflict
      throw new Error('User with this email already exists');
    }

    // 2. Generate username (reuse your helper)
    const username = await generateUsername(input.name, qr);
    const dummyPasswordHash = await bcrypt.hash('google-oauth-no-password', 12);

    const rows = (await qr.query(
      `INSERT INTO "users" (
    "id", "name", "username", "email", "phone", "password_hash",
    "email_verified", "phone_verified", "kyc_status", "role",
    "is_suspended", "profile_picture_url", "created_at"
  ) VALUES (
    gen_random_uuid(), $1, $2, $3, $4, $5,     -- $4 is now phone (NULL)
    true, false, 'unverified', $6,
    false, $7, now()
  )
  RETURNING "id", "name", "username", "email", "email_verified", 
            "kyc_status", "role", "profile_picture_url"`,
      [
        name,
        username,
        input.email,
        null,                    // ← phone = null (now allowed)
        dummyPasswordHash,
        UserRole.user,
        input.picture || null
      ]
    )) as any[];

    const user = rows[0] as { id: string; role: UserRole; kyc_status: string };

    // Create wallets
    const currencies = [Currency.NGN, Currency.GBP, Currency.USD, Currency.CAD] as const;
    for (const currency of currencies) {
      await qr.query(
        `INSERT INTO "wallets" ("id","user_id","currency","balance","locked_balance","updated_at")
         VALUES (gen_random_uuid(), $1, $2, 0, 0, now())`,
        [user.id, currency],
      );
    }

    // Create welcome notification
    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: user.id,
      title: 'Welcome to Sabo Finance',
      message: 'Your account has been successfully created via Google. Your email is already verified!',
      type: NotificationType.success,
    });

    return rows[0];
  });

  const user = result as unknown as {
    id: string;
    name: string;
    username: string;
    email: string;
    role: UserRole;
    kyc_status: string;
    email_verified: boolean;
    profile_picture_url?: string;
  };

  // Since email is already verified via Google, we can skip the verification email
  // But still send a welcome email
  const websiteUrl = env.WEBSITE_URL ?? 'https://sabofinance.com';
  await sendEmail({
    to: user.email,
    subject: 'Welcome to Sabo Finance — your seat at the table is ready',
    template: 'welcome',
    context: {
      name: user.name,
      learnLink: `${websiteUrl}/learn`,
      profileLink: `${websiteUrl}/settings/profile`,
      helpCenterLink: env.HELP_CENTER_URL ?? `${websiteUrl}/help`,
      contactLink: env.CONTACT_URL ?? `${websiteUrl}/contact`,
    },
  });

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  return created(res, {
    user,
    tokens: { accessToken, refreshToken }
  });
}

/**
 * @swagger
 * /auth/google/callback:
 *   get:
 *     summary: Google OAuth Callback
 *     tags: [Auth]
 *     description: Google redirects here after authentication
 */
export async function googleCallback(req: Request, res: Response) {
  passport.authenticate('google', { session: false }, async (err: any, user: any) => {
    if (err || !user) {
      const frontendErrorUrl = `${env.WEBSITE_URL ?? 'https://sabofinance.com'}/auth/callback?error=google_auth_failed`;
      return res.redirect(frontendErrorUrl);
    }

    try {
      const accessToken = signAccessToken(user);
      const refreshToken = signRefreshToken(user);

      const frontendUrl = env.WEBSITE_URL ?? 'https://sabofinance.com';

      // Redirect to frontend with tokens in query params (simple for SPA)
      res.redirect(
        `${frontendUrl}/auth/callback?accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}`
      );
    } catch (error) {
      const frontendErrorUrl = `${env.WEBSITE_URL ?? 'https://sabofinance.com'}/auth/callback?error=server_error`;
      res.redirect(frontendErrorUrl);
    }
  })(req, res);
}

/**
 * @swagger
 * /auth/verify-email:
 *   get:
 *     summary: Verify email using signed token
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Email verified
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 *       400:
 *         description: Invalid token
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiErrorEnvelope" }
 */
export async function verifyEmail(req: Request, res: Response) {
  const { token } = verifyEmailSchema.parse(req.query);

  let payload: { id?: string; email?: string; purpose?: string };
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as { id?: string; email?: string; purpose?: string };
  } catch {
    throw new AppError('INVALID_TOKEN', 'Email verification link is invalid or has expired. Request a new verification email.', 400);
  }

  if (!payload.id || payload.purpose !== 'verify-email') {
    throw new AppError('INVALID_TOKEN', 'Email verification link is invalid or has expired.', 400);
  }

  await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT "id","email_verified" FROM "users" WHERE "id" = $1 LIMIT 1`,
      [payload.id],
    )) as Array<{ id: string; email_verified: boolean }>;
    const user = rows[0];

    if (!user) throw new AppError('USER_NOT_FOUND', 'No user exists for this verification link.', 404);
    if (!user.email_verified) {
      await qr.query(`UPDATE "users" SET "email_verified" = true WHERE "id" = $1`, [payload.id]);
    }
  });

  return ok(res, { message: 'Email verified successfully' });
}

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, example: "jane@example.com" }
 *               password: { type: string, example: "Password123!" }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiErrorEnvelope" }
 */
export async function login(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);

  const rows = (await withTransaction(async (qr) => {
    return (await qr.query(
      `SELECT "id","password_hash","role","email","name","kyc_status","is_suspended","deleted_at" FROM "users" WHERE "email" = $1 LIMIT 1`,
      [input.email.toLowerCase()],
    )) as Array<{ id: string; password_hash: string; role: UserRole; email: string; name: string; kyc_status: string; }>;
  })) as Array<{ id: string; password_hash: string; role: UserRole; email: string; name: string; kyc_status: string; }>;

  const user = rows[0];
  if (!user) throw new UnauthorizedError('Invalid email or password.', 'INVALID_CREDENTIALS');
  if ((user as unknown as { is_suspended?: boolean; deleted_at?: Date | null }).deleted_at) {
    throw new AppError('ACCOUNT_DELETED', 'This account has been deleted.', 401);
  }
  if ((user as unknown as { is_suspended?: boolean }).is_suspended) {
    throw new AppError('ACCOUNT_SUSPENDED', 'This account is suspended.', 401);
  }

  const okPass = await bcrypt.compare(input.password, user.password_hash);
  if (!okPass) throw new UnauthorizedError('Invalid email or password.', 'INVALID_CREDENTIALS');

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otp_expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await withTransaction(async (qr) => {
    await qr.query(
      'UPDATE "users" SET "otp" = $1, "otp_expires" = $2, "otp_purpose" = $3, "otp_target_email" = NULL WHERE "id" = $4',
      [otp, otp_expires, 'login', user.id],
    );
  });

  await sendEmail({
    to: user.email,
    subject: 'Your OTP for Sabo Finance',
    template: 'otp',
    context: { otp },
  });

  return ok(res, { message: 'An OTP has been sent to your email.' });
}

const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
});

/**
 * @swagger
 * /auth/verify-otp:
 *   post:
 *     summary: Verify OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email: { type: string, example: "jane@example.com" }
 *               otp: { type: string, example: "123456" }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 *       400:
 *         description: Invalid or expired OTP
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiErrorEnvelope" }
 */
export async function verifyOtp(req: Request, res: Response) {
  const input = verifyOtpSchema.parse(req.body);

  const user = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      'SELECT "id", "name", "email", "role", "kyc_status","is_suspended","deleted_at" FROM "users" WHERE "email" = $1 AND "otp" = $2 AND "otp_purpose" = $3 AND "otp_expires" > NOW() LIMIT 1',
      [input.email.toLowerCase(), input.otp, 'login'],
    )) as Array<{ id: string; name: string; email: string; role: UserRole; kyc_status: string; is_suspended: boolean; deleted_at: Date | null }>;

    return rows[0];
  });

  if (!user) {
    throw new AppError('INVALID_OTP', 'That sign-in code is incorrect or has expired. Request a new OTP from the login screen.', 400);
  }
  if (user.deleted_at) throw new AppError('ACCOUNT_DELETED', 'This account has been deleted.', 401);
  if (user.is_suspended) throw new AppError('ACCOUNT_SUSPENDED', 'This account is suspended.', 401);

  await withTransaction(async (qr) => {
    await qr.query(
      'UPDATE "users" SET "otp" = NULL, "otp_expires" = NULL, "otp_purpose" = NULL, "otp_target_email" = NULL WHERE "id" = $1',
      [user.id],
    );
  });

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  return ok(res, { tokens: { accessToken, refreshToken } });
}

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout (client-side token discard)
 *     tags: [Auth]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function logout(_req: Request, res: Response) {
  return ok(res, { loggedOut: true });
}

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get currently authenticated user profile
 *     tags: [Auth]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiErrorEnvelope" }
 */
export async function getMe(req: Request, res: Response) {
  if (!req.user) throw new UnauthorizedError();

  const user = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      `SELECT 
         "id", 
         "name", 
         "username",
         "email", 
         "phone", 
         "email_verified", 
         "phone_verified", 
         "kyc_status",
         "transaction_pin_set",
         "role", 
         "profile_picture_url",
         "is_suspended", 
         "created_at" 
       FROM "users" 
       WHERE "id" = $1 
       LIMIT 1`,
      [req.user!.id],
    )) as Array<Record<string, unknown>>;

    return rows[0];
  });

  if (!user) {
    throw new AppError('USER_NOT_FOUND', 'Your profile could not be loaded. Please sign in again.', 401);
  }

  return ok(res, { user });
}

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Forgot password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, example: "jane@example.com" }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 */
export async function forgotPassword(req: Request, res: Response) {
  const input = forgotPasswordSchema.parse(req.body);

  await withTransaction(async (qr) => {
    const rows = (await qr.query('SELECT "id", "name", "email" FROM "users" WHERE "email" = $1 LIMIT 1', [
      input.email.toLowerCase(),
    ])) as Array<{ id: string; name: string; email: string }>;

    const user = rows[0];
    if (!user) return;

    const resetToken = crypto.randomBytes(32).toString('hex');
    const password_reset_token = crypto.createHash('sha256').update(resetToken).digest('hex');
    const password_reset_expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await qr.query(
      'UPDATE "users" SET "password_reset_token" = $1, "password_reset_expires" = $2 WHERE "id" = $3',
      [password_reset_token, password_reset_expires, user.id],
    );

    // In a real application, you would send an email with the resetToken
    const resetLink = `https://sabofinance.com/reset-password?token=${resetToken}`;
    await sendEmail({
      to: input.email.toLowerCase(),
      subject: 'Reset Your Password',
      template: 'forgot-password',
      context: { resetLink },
    });
    console.log(`Password reset link sent to ${input.email}: ${resetLink}`);
  });

  return ok(res, {
    message: 'If a user with that email exists, a password reset link has been sent.',
  });
}

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Reset password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token: { type: string, example: "..." }
 *               password: { type: string, example: "NewPassword123!" }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 *       400:
 *         description: Invalid or expired token
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiErrorEnvelope" }
 */
export async function resetPassword(req: Request, res: Response) {
  const input = resetPasswordSchema.parse(req.body);
  const password_reset_token = crypto.createHash('sha256').update(input.token).digest('hex');

  const user = await withTransaction(async (qr) => {
    const rows = (await qr.query(
      'SELECT "id", "name", "email" FROM "users" WHERE "password_reset_token" = $1 AND "password_reset_expires" > NOW() LIMIT 1',
      [password_reset_token],
    )) as Array<{ id: string; name: string; email: string }>;

    return rows[0];
  });

  if (!user) {
    throw new AppError('INVALID_TOKEN', 'Password reset link is invalid or has expired. Request a new reset from the login page.', 400);
  }

  const password_hash = await bcrypt.hash(input.password, 12);

  await withTransaction(async (qr) => {
    await qr.query(
      'UPDATE "users" SET "password_hash" = $1, "password_reset_token" = NULL, "password_reset_expires" = NULL WHERE "id" = $2',
      [password_hash, user.id,
      ]);

    const notificationService = new NotificationService();
    await notificationService.createNotification({
      queryRunner: qr,
      userId: user.id,
      title: 'Password Changed',
      message: 'Your password has been successfully changed.',
      type: NotificationType.warning,
    });

    await sendEmail({
      to: user.email,
      subject: 'Security Alert: Password Changed',
      template: 'security-alert',
      context: {
        name: user.name,
        message: 'Your password has been successfully changed. If you did not authorize this, please contact support immediately.',
      },
    });
  });

  return ok(res, { message: 'Password has been reset successfully.' });
}

/**
 * @swagger
 * /auth/refresh-token:
 *   post:
 *     summary: Refresh access token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" }
 *       401:
 *         description: Invalid refresh token
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiErrorEnvelope" }
 */
export async function refreshToken(req: Request, res: Response) {
  const input = await refreshTokenSchema.parse(req.body);

  if (!input.refreshToken) {
    throw new AppError('REFRESH_TOKEN_MISSING', 'Refresh token is required', 400);
  }

  try {

    if (!env.JWT_REFRESH_SECRET)
      throw new AppError('CONFIG_ERROR', 'JWT_REFRESH_SECRET is required', 500);
    const payload = jwt.verify(input.refreshToken, env.JWT_REFRESH_SECRET) as {
      id: string;
      name: string;
      email: string;
      role: UserRole;
      kyc_status: string;
    };

    if (!payload.id || !payload.role) {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Refresh token payload is invalid', 401);
    }

    // Optional: verify user exists
    const user = await withTransaction(async (qr) => {
      const rows = (await qr.query(
        'SELECT "id", "name", "email", "role", "kyc_status", "is_suspended", "deleted_at" FROM "users" WHERE "id" = $1 LIMIT 1',
        [payload.id],
      )) as Array<{ id: string; name: string; email: string; role: UserRole; kyc_status: string; is_suspended: boolean; deleted_at: Date | null }>;
      return rows[0];
    });

    if (!user) throw new AppError('USER_NOT_FOUND', 'No user exists for this refresh token.', 401);
    if (user.deleted_at) throw new AppError('ACCOUNT_DELETED', 'This account has been deleted.', 401);
    if (user.is_suspended) throw new AppError('ACCOUNT_SUSPENDED', 'This account is suspended.', 401);

    // Issue new tokens
    const newAccessToken = signAccessToken(user);
    const newRefreshToken = signRefreshToken(user);

    return ok(res, { tokens: { accessToken: newAccessToken, refreshToken: newRefreshToken } });
  } catch {
    throw new AppError('INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired. Sign in again to obtain new tokens.', 401);
  }
}
