// ====================================================================
// AURUM CRM — Permission matrix
// --------------------------------------------------------------------
// Static role × action map used everywhere (UI gating + display on the
// permissions page). Kept in sync with RLS policies in schema.sql.
//
// Actions use a `resource:action` naming convention. `can()` also
// supports wildcard checks: can("viewer","dashboard:*") returns true
// if viewer has any dashboard permission.
// ====================================================================

// `owner` is the highest role (above super_admin) — reserved for the system
// owner/CEO. It is intentionally NOT listed in ROLES: ROLES drives the
// role-assignment dropdowns and the permissions-matrix page, and `owner` must
// not be assignable there. `can()`, ROLE_LABELS and ROLE_RANK below still know
// about it, so an owner gets full access everywhere.
const ROLES = ["super_admin", "admin", "manager", "operator", "viewer"];

const ROLE_LABELS = {
  owner:       "Owner",
  super_admin: "Super Admin",
  admin:       "Admin",
  manager:     "Manager",
  operator:    "Operator",
  viewer:      "Viewer",
};

const ROLE_RANK = { owner: 6, super_admin: 5, admin: 4, manager: 3, operator: 2, viewer: 1 };

// Matrix: role → { permission: true }
const PERMISSIONS = {
  // Owner (system owner/CEO) — highest role, full access. Superset of
  // super_admin; used for gating owner-only features like the signup
  // approval-mode toggle.
  owner: {
    "dashboard:view":   true,
    "users:view":       true,
    "users:create":     true,
    "users:edit":       true,
    "users:suspend":    true,
    "users:reset_pw":   true,
    "users:delete":     true,
    "users:assign_role":true,
    "customers:view":   true,
    "customers:edit":   true,
    "mt5:view":         true,
    "subscriptions:view": true,
    "permissions:view": true,
    "permissions:edit": true,
    "activity:view":    true,
    "activity:export":  true,
    "settings:view":    true,
    "settings:edit_self": true,
  },
  super_admin: {
    "dashboard:view":   true,
    "users:view":       true,
    "users:create":     true,
    "users:edit":       true,
    "users:suspend":    true,
    "users:reset_pw":   true,
    "users:delete":     true,
    "users:assign_role":true,
    "customers:view":   true,
    "customers:edit":   true,
    "mt5:view":         true,
    "subscriptions:view": true,
    "permissions:view": true,
    "permissions:edit": true,
    "activity:view":    true,
    "activity:export":  true,
    "settings:view":    true,
    "settings:edit_self": true,
  },
  admin: {
    "dashboard:view":   true,
    "users:view":       true,
    "users:create":     true,
    "users:edit":       true,
    "users:suspend":    true,
    "users:reset_pw":   true,
    "users:delete":     false,
    "users:assign_role":true,
    "customers:view":   true,
    "customers:edit":   true,
    "mt5:view":         true,
    "subscriptions:view": true,
    "permissions:view": true,
    "permissions:edit": false,
    "activity:view":    true,
    "activity:export":  true,
    "settings:view":    true,
    "settings:edit_self": true,
  },
  manager: {
    "dashboard:view":   true,
    "users:view":       true,
    "users:create":     false,
    "users:edit":       true,
    "users:suspend":    true,
    "users:reset_pw":   true,
    "users:delete":     false,
    "users:assign_role":false,
    "customers:view":   true,
    "customers:edit":   false,
    "mt5:view":         true,
    "subscriptions:view": true,
    "permissions:view": true,
    "permissions:edit": false,
    "activity:view":    true,
    "activity:export":  false,
    "settings:view":    true,
    "settings:edit_self": true,
  },
  operator: {
    "dashboard:view":   true,
    "users:view":       true,
    "users:create":     false,
    "users:edit":       false,
    "users:suspend":    false,
    "users:reset_pw":   false,
    "users:delete":     false,
    "users:assign_role":false,
    "customers:view":   false,
    "customers:edit":   false,
    "mt5:view":         false,
    "subscriptions:view": false,
    "permissions:view": true,
    "permissions:edit": false,
    "activity:view":    true,
    "activity:export":  false,
    "settings:view":    true,
    "settings:edit_self": true,
  },
  viewer: {
    "dashboard:view":   true,
    "users:view":       true,
    "users:create":     false,
    "users:edit":       false,
    "users:suspend":    false,
    "users:reset_pw":   false,
    "users:delete":     false,
    "users:assign_role":false,
    "customers:view":   false,
    "customers:edit":   false,
    "mt5:view":         false,
    "subscriptions:view": false,
    "permissions:view": true,
    "permissions:edit": false,
    "activity:view":    false,
    "activity:export":  false,
    "settings:view":    true,
    "settings:edit_self": true,
  },
};

const PERMISSION_GROUPS = [
  { label: "Dashboard",   keys: ["dashboard:view"] },
  { label: "Users",       keys: ["users:view","users:create","users:edit","users:suspend","users:reset_pw","users:delete","users:assign_role"] },
  { label: "Customers",   keys: ["customers:view","customers:edit"] },
  { label: "MT5",         keys: ["mt5:view"] },
  { label: "Subscriptions", keys: ["subscriptions:view"] },
  { label: "Permissions", keys: ["permissions:view","permissions:edit"] },
  { label: "Activity",    keys: ["activity:view","activity:export"] },
  { label: "Settings",    keys: ["settings:view","settings:edit_self"] },
];

const PERMISSION_LABELS = {
  "dashboard:view":     "View dashboard",
  "users:view":         "View users",
  "users:create":       "Create users",
  "users:edit":         "Edit users",
  "users:suspend":      "Suspend users",
  "users:reset_pw":     "Reset password",
  "users:delete":       "Delete users",
  "users:assign_role":  "Assign role",
  "customers:view":     "View customers",
  "customers:edit":     "Manage customers",
  "mt5:view":           "View MT5 connections",
  "subscriptions:view": "View subscriptions",
  "permissions:view":   "View permissions",
  "permissions:edit":   "Edit permissions",
  "activity:view":      "View activity log",
  "activity:export":    "Export activity CSV",
  "settings:view":      "View settings",
  "settings:edit_self": "Edit own profile",
};

/**
 * can(role, key) — `key` is "resource:action" or "resource:*".
 */
function can(role, key) {
  if (!role || !key) return false;
  const grants = PERMISSIONS[role];
  if (!grants) return false;
  if (key.endsWith(":*")) {
    const prefix = key.slice(0, -1); // "resource:"
    return Object.entries(grants).some(([k, v]) => v && k.startsWith(prefix));
  }
  return !!grants[key];
}

function roleOutranks(a, b) {
  return (ROLE_RANK[a] ?? 0) > (ROLE_RANK[b] ?? 0);
}

window.AurumPerms = {
  ROLES, ROLE_LABELS, ROLE_RANK, PERMISSIONS,
  PERMISSION_GROUPS, PERMISSION_LABELS,
  can, roleOutranks,
};
