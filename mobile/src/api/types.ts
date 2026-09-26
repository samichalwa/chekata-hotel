// Mirrors shared/schema.ts MODULE_KEYS in the CHAIMS backend — keep in sync
// if modules are ever added/removed there.
export const MODULE_KEYS = [
  "dashboard",
  "accommodation",
  "facilities",
  "movie-room",
  "bar-restaurant",
  "staff",
  "expenses",
  "maintenance",
  "lists",
  "reports",
  "documents",
  "settings",
  "finance",
  "system-admin",
  "inventory",
  "purchasing",
  "internal-requisitions",
  "tenants",
  "fnb-costing",
  "attendance",
  "leave",
  "payroll",
  "budgeting",
  "assets",
  "water-sales",
  "hr",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface SafeUser {
  id: number;
  username: string;
  fullName: string;
  isAdmin: number;
  permissions: string; // JSON-encoded ModuleKey[]
  canEditMovieBookings?: number;
  canManageTablesList?: number;
  canManageMenuItemsList?: number;
  canCloseMaintenanceIssues?: number;
  canAdjustInventory?: number;
  canAccessLive?: number;
  canAccessTest?: number;
  active: number;
  createdAt: number;
}

export interface LoginResponse extends SafeUser {
  sessionToken: string;
  environment?: "live" | "test";
}

export function parseModulePermissions(user: SafeUser | null): ModuleKey[] {
  if (!user) return [];
  if (user.isAdmin) return [...MODULE_KEYS];
  try {
    const arr = JSON.parse(user.permissions);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function hasModule(user: SafeUser | null, key: ModuleKey): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  return parseModulePermissions(user).includes(key);
}

export function hasAnyModule(user: SafeUser | null, keys: ModuleKey[]): boolean {
  return keys.some((k) => hasModule(user, k));
}
