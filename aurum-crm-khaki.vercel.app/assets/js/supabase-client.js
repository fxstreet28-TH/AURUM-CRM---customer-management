// Thin wrapper around the Supabase JS client so pages don't all have
// to import from the CDN. Loaded after supabase-js UMD.
(function () {
  const cfg = window.AURUM_CONFIG || {};
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("Supabase UMD not loaded before supabase-client.js");
    return;
  }
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.startsWith("__")) {
    console.warn("AURUM_CONFIG.SUPABASE_URL not set — edit assets/js/config.js");
  }
  window.sb = window.supabase.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "aurum-crm-auth",
      },
    },
  );
})();
