// ====================================================================
// AURUM CRM — Public client config
// --------------------------------------------------------------------
// Only the Supabase *anon* key and project URL belong here. The
// service_role key and RESEND_API_KEY must NEVER be bundled in the
// client — they live in Edge Function secrets only (see README).
//
// For local development you can either edit this file or host it on
// Vercel as an environment-driven config (see README → Vercel).
// ====================================================================
window.AURUM_CONFIG = {
  SUPABASE_URL:     "https://hknvooaqgpufrbdxtzxf.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrbnZvb2FxZ3B1ZnJiZHh0enhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMTI1MDcsImV4cCI6MjEwMTU4ODUwN30.Zom2N7qaijBshZyHvhZ6vXGPR5jx3sDGk_PMJXWR71g",
  INVITE_FUNCTION_PATH: "/functions/v1/invite-user",
  DELETE_FUNCTION_PATH: "/functions/v1/delete-user",
  MT5_FUNCTION_PATH:    "/functions/v1/admin-mt5-connections",
  SUBS_FUNCTION_PATH:   "/functions/v1/crm-subscriptions-list",
  CUSTOMER_SUBS_FUNCTION_PATH: "/functions/v1/crm-customer-subscriptions",
  CUSTOMER_DETAIL_FUNCTION_PATH: "/functions/v1/crm-customer-detail",
  DELETE_CUSTOMER_FUNCTION_PATH: "/functions/v1/crm-delete-customer",
  SIGNUP_MODE_FUNCTION_PATH: "/functions/v1/crm-signup-approval-mode",
  SUPER_ADMIN_EMAIL: "porforex599@gmail.com",
  // Base URL of the aurum-wallet-api backend (manual-credit endpoints).
  // Leave blank until the backend is deployed; pages that depend on it
  // will surface a clear error when called. No trailing slash.
  WALLET_API_URL:      "https://aurum-wallet-api-production.up.railway.app",
  APP_NAME:          "AURUM CRM",
};
