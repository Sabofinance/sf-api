import { UserRole, KycStatus } from '../utils/enums';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        email: string;
        role: UserRole;
        kyc_status: KycStatus;
      };
    }
  }
}

