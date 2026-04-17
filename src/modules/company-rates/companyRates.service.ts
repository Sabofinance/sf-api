import { withTransaction } from '../../database/transaction';
import { NotFoundError } from '../../utils/errors';
import { CompanyRateRepository, CompanyRateRecord } from './companyRates.repository';

export class CompanyRateService {
  public static async getAllRates(): Promise<CompanyRateRecord[]> {
    return withTransaction(async (qr) => CompanyRateRepository.findAll(qr));
  }

  public static async getRateByCurrency(currency: string): Promise<CompanyRateRecord> {
    const rate = await withTransaction(async (qr) => CompanyRateRepository.findByCurrency(qr, currency));
    if (!rate) {
      throw new NotFoundError(`Company rate not found for currency ${currency}`, 'COMPANY_RATE_NOT_FOUND');
    }

    return rate;
  }

  public static async createOrUpdateRate(currency: string, rate_ngn: string): Promise<CompanyRateRecord> {
    return withTransaction(async (qr) => CompanyRateRepository.upsertRate(qr, currency, rate_ngn));
  }
}
