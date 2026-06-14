import { UserRole } from '../utils/enums';
import type { Permission } from '../utils/observabilityEnums';

export const PERMISSIONS: Record<Permission, UserRole[]> = {
  'kyc.approve': [UserRole.admin, UserRole.super_admin],
  'deposits.approve': [UserRole.admin, UserRole.super_admin],
  'withdrawals.approve': [UserRole.admin, UserRole.super_admin],
  'disputes.resolve': [UserRole.admin, UserRole.super_admin],
  'admins.invite': [UserRole.super_admin],
  'admins.remove': [UserRole.super_admin],
  'company_rates.manage': [UserRole.super_admin],
  'analytics.view': [UserRole.admin, UserRole.super_admin],
  'users.manage': [UserRole.admin, UserRole.super_admin],
  'reliability.view': [UserRole.admin, UserRole.super_admin],
  'security.view': [UserRole.super_admin],
};

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return PERMISSIONS[permission]?.includes(role) ?? false;
}

export function getPermissionMatrix(): Array<{ permission: Permission; roles: UserRole[] }> {
  return (Object.entries(PERMISSIONS) as Array<[Permission, UserRole[]]>).map(
    ([permission, roles]) => ({ permission, roles }),
  );
}
