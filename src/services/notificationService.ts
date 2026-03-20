import { QueryRunner } from 'typeorm';
import { NotificationType, NotificationStatus } from '../utils/enums';

export class NotificationService {
  async createNotification(params: {
    queryRunner: QueryRunner;
    userId?: string;
    title: string;
    message: string;
    type?: NotificationType;
    relatedId?: string;
  }) {
    const { queryRunner, userId, title, message, type, relatedId } = params;

    await queryRunner.query(
      `INSERT INTO "notifications" ("id", "user_id", "title", "message", "type", "status", "related_id", "created_at")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())`,
      [
        userId || null,
        title,
        message,
        type || NotificationType.info,
        NotificationStatus.unread,
        relatedId || null,
      ],
    );
  }

  async notifyAdmin(params: {
    queryRunner: QueryRunner;
    title: string;
    message: string;
    type?: NotificationType;
    relatedId?: string;
  }) {
    await this.createNotification({ ...params, userId: undefined });
  }
}