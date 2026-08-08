// ====================================================================
// AURUM CRM — Auth guard + current user helpers
// --------------------------------------------------------------------
// Usage on every page except index.html:
//   <script src="assets/js/auth.js"></script>
//   <script>AurumAuth.guard().then(ctx => AurumApp.boot(ctx));</script>
// ====================================================================

(function () {
  const LOGIN_PAGE = "index.html";

  async function currentSession() {
    const { data } = await sb.auth.getSession();
    return data.session ?? null;
  }

  async function currentProfile(session) {
    if (!session?.user?.id) return null;
    const { data, error } = await sb
      .from("profiles")
      .select("id, email, full_name, role, status, must_change_pw, last_login_at")
      .eq("id", session.user.id)
      .maybeSingle();
    if (error) { console.error(error); return null; }
    return data;
  }

  // Record sensitive actions client-side. Will succeed if RLS allows
  // (self-insert) — otherwise fails silently.
  async function log(action, extra = {}) {
    try {
      const sess = await currentSession();
      if (!sess?.user?.id) return;
      await sb.from("activity_logs").insert({
        actor_id:      sess.user.id,
        actor_email:   sess.user.email,
        action,
        resource_type: extra.resource_type ?? null,
        resource_id:   extra.resource_id   ?? null,
        metadata:      extra.metadata      ?? {},
        ua:            navigator.userAgent,
      });
    } catch (e) { console.warn("activity log failed", e); }
  }

  // Redirect helpers used in page guards.
  function toLogin(reason)  { window.location.replace(`${LOGIN_PAGE}${reason ? `?m=${encodeURIComponent(reason)}`:""}`); }
  function toDashboard()    { window.location.replace("dashboard.html"); }

  /**
   * guard({ permission? }) — run at page load.
   * Redirects to login if no session, to dashboard if permission check
   * fails, and forces password-change UX if the profile demands it.
   */
  async function guard(opts = {}) {
    const sess = await currentSession();
    if (!sess) { toLogin("signin"); return new Promise(() => {}); }

    const profile = await currentProfile(sess);
    if (!profile)              { await sb.auth.signOut(); toLogin("noprofile"); return new Promise(() => {}); }
    if (profile.status === "suspended") { await sb.auth.signOut(); toLogin("suspended"); return new Promise(() => {}); }

    // must_change_pw — allow settings page so user can change it.
    // Normalize pathname so both "/settings" (cleanUrls) and
    // "/settings.html" are treated the same — otherwise the guard would
    // loop when Vercel strips the extension.
    const here = (location.pathname.split("/").pop() || "").replace(/\.html$/, "");
    if (profile.must_change_pw && here !== "settings") {
      window.location.replace("settings.html?force_pw=1");
      return new Promise(() => {});
    }

    if (opts.permission && !AurumPerms.can(profile.role, opts.permission)) {
      toDashboard(); return new Promise(() => {});
    }

    if (opts.requireEmail) {
      const need = String(opts.requireEmail).toLowerCase();
      if ((profile.email || "").toLowerCase() !== need) {
        toDashboard(); return new Promise(() => {});
      }
    }

    // Touch last_login_at once per session on first guarded page load.
    if (!sessionStorage.getItem("aurum:loggedTouch")) {
      sessionStorage.setItem("aurum:loggedTouch", "1");
      sb.from("profiles").update({ last_login_at: new Date().toISOString() })
        .eq("id", profile.id).then(() => {});
      log("auth.session_start");
    }

    return { session: sess, profile };
  }

  async function signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    await log("auth.sign_out");
    await sb.auth.signOut();
    sessionStorage.removeItem("aurum:loggedTouch");
    toLogin();
  }

  async function changePassword(newPassword) {
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
    const { data: sess } = await sb.auth.getSession();
    if (sess?.session?.user?.id) {
      await sb.from("profiles")
        .update({ must_change_pw: false, status: "active" })
        .eq("id", sess.session.user.id);
    }
    await log("auth.password_changed");
  }

  window.AurumAuth = {
    guard, signIn, signOut, changePassword,
    currentSession, currentProfile, log,
    toLogin, toDashboard,
  };
})();
