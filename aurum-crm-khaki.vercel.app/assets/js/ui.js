// ====================================================================
// AURUM CRM — UI shell (sidebar, topbar, toast, modal, formatters)
// ====================================================================

(function () {
  const NAV = [
    { href: "dashboard.html",   label: "Dashboard",   perm: "dashboard:view",   icon: iconDashboard },
    { href: "users.html",       label: "Users",       perm: "users:view",       icon: iconUsers },
    { href: "customers.html",   label: "Customers",   perm: "customers:view",   icon: iconCustomers },
    { href: "mt5-connections.html", label: "MT5 Connections", perm: "mt5:view",     icon: iconMt5 },
    { href: "subscriptions.html", label: "Subscriptions", perm: "subscriptions:view", icon: iconSubscriptions },
    { href: "buybacks.html",    label: "Buybacks",    perm: "buybacks:view",    icon: iconBuyback },
    { href: "add-credit.html",    label: "Add Credit",    emailGate: true,          icon: iconAddCredit },
    { href: "remove-credit.html", label: "Remove Credit", emailGate: true,          icon: iconRemoveCredit },
    { href: "credit-log.html",    label: "Credit Log",    emailGate: true,          icon: iconCreditLog },
    { href: "system-health.html", label: "System Health", perm: "settings:view",    icon: iconHealth },
    { href: "permissions.html", label: "Permissions", perm: "permissions:view", icon: iconShield },
    { href: "activity.html",    label: "Activity",    perm: "activity:view",    icon: iconActivity },
    { href: "settings.html",    label: "Settings",    perm: "settings:view",    icon: iconSettings },
  ];

  function navAllowed(item, profile) {
    if (item.emailGate) {
      const allowed = (window.AURUM_CONFIG && window.AURUM_CONFIG.SUPER_ADMIN_EMAIL || "").toLowerCase();
      return !!allowed && (profile.email || "").toLowerCase() === allowed;
    }
    return AurumPerms.can(profile.role, item.perm);
  }

  function here() { return location.pathname.split("/").pop() || "dashboard.html"; }

  function renderShell(ctx) {
    const { profile } = ctx;
    const active = here();
    const items = NAV.filter(n => navAllowed(n, profile)).map(n => `
      <a href="${n.href}"
         class="group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition
                ${active === n.href
                  ? "nav-active"
                  : "nav-idle"}">
        <span class="w-5 h-5 ${active === n.href ? "text-aurum-gold" : "text-gray-400 group-hover:text-aurum-gold"}">${n.icon()}</span>
        ${n.label}
      </a>`).join("");

    const sidebar = document.getElementById("aurum-sidebar");
    if (sidebar) sidebar.innerHTML = `
      <div class="h-20 flex items-center px-5 border-b border-white/10">
        <div class="brand-mark">A</div>
        <div class="ml-3">
          <div class="font-display text-base font-extrabold tracking-[.12em] text-white"><span class="text-aurum-gold">AURUM</span> CRM</div>
          <div class="text-[10px] uppercase tracking-[.22em] text-gray-500">Admin Console</div>
        </div>
      </div>
      <div class="px-5 pt-5 pb-2 text-[10px] font-semibold uppercase tracking-[.2em] text-gray-600">Management</div>
      <nav class="px-3 pb-4 space-y-1">${items}</nav>
      <div class="mt-auto p-3 border-t border-white/10">
        <div class="flex items-center gap-3 px-2 py-2">
          <div class="w-9 h-9 rounded-xl bg-aurum-gold text-black flex items-center justify-center font-bold shadow-lg shadow-yellow-500/10">
            ${escapeHtml((profile.full_name || profile.email).slice(0,1).toUpperCase())}
          </div>
          <div class="min-w-0">
            <div class="text-sm font-medium text-white truncate">${escapeHtml(profile.full_name || profile.email)}</div>
            <div class="text-xs text-gray-500 truncate">${escapeHtml(AurumPerms.ROLE_LABELS[profile.role] || profile.role)}</div>
          </div>
        </div>
        <button id="aurum-signout"
          class="mt-2 w-full text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg px-3 py-2 text-left">
          Sign out
        </button>
      </div>`;

    const topbar = document.getElementById("aurum-topbar");
    if (topbar) topbar.innerHTML = `
      <div class="h-20 flex items-center justify-between px-6 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div>
          <div class="flex items-center gap-2"><span class="admin-pill">ADMIN</span><span class="text-[11px] text-gray-400">AURUM CONTROL CENTER</span></div>
          <h1 class="font-display text-xl font-bold text-aurum-ink mt-0.5">${escapeHtml(document.title.replace(/\s*[·—].*$/,""))}</h1>
          <p class="text-xs text-gray-500" data-aurum-subtitle></p>
        </div>
        <div class="flex items-center gap-2">
          <a href="system-health.html" class="system-chip"><span class="status-dot"></span> System online</a>
          <span class="hidden lg:inline text-xs text-gray-500 border-l pl-3">${escapeHtml(profile.email)}</span>
        </div>
      </div>`;

    const btn = document.getElementById("aurum-signout");
    if (btn) btn.addEventListener("click", () => AurumAuth.signOut());
  }

  function setSubtitle(text) {
    const el = document.querySelector("[data-aurum-subtitle]");
    if (el) el.textContent = text || "";
  }

  // ---- Toasts --------------------------------------------------------
  function toast(message, type = "info") {
    let host = document.getElementById("aurum-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "aurum-toast-host";
      host.className = "fixed bottom-6 right-6 z-[999] space-y-2";
      document.body.appendChild(host);
    }
    const colors = {
      info:    "bg-gray-900 text-white",
      success: "bg-emerald-600 text-white",
      error:   "bg-rose-600 text-white",
      warn:    "bg-amber-500 text-white",
    };
    const el = document.createElement("div");
    el.className = `px-4 py-2.5 rounded-lg shadow-lg text-sm ${colors[type] || colors.info} animate-fade-in`;
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => { el.classList.add("opacity-0","transition","translate-y-2"); setTimeout(() => el.remove(), 300); }, 3400);
  }

  // ---- Modal ---------------------------------------------------------
  function modal({ title, bodyHtml, confirmLabel = "Save", cancelLabel = "Cancel", confirmClass = "bg-aurum-gold text-aurum-ink hover:brightness-95", onConfirm }) {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "fixed inset-0 z-[998] flex items-center justify-center p-4 bg-gray-900/40";
      wrap.innerHTML = `
        <div class="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-100">
            <h3 class="font-display text-lg font-semibold text-aurum-ink">${escapeHtml(title)}</h3>
          </div>
          <div class="px-6 py-5">${bodyHtml}</div>
          <div class="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2">
            <button data-role="cancel"  class="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100">${escapeHtml(cancelLabel)}</button>
            <button data-role="confirm" class="px-4 py-2 rounded-lg text-sm font-semibold ${confirmClass}">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const close = (val) => { wrap.remove(); resolve(val); };
      wrap.addEventListener("click", e => { if (e.target === wrap) close(null); });
      wrap.querySelector('[data-role="cancel"]').addEventListener("click", () => close(null));
      wrap.querySelector('[data-role="confirm"]').addEventListener("click", async () => {
        try {
          const result = onConfirm ? await onConfirm(wrap) : true;
          if (result !== false) close(result);
        } catch (e) { toast(e.message || "Error", "error"); }
      });
    });
  }

  // ---- Formatters ----------------------------------------------------
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }
  function fmtRelative(iso) {
    if (!iso) return "—";
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)    return "just now";
    if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff/86400)}d ago`;
    return fmtDate(iso);
  }
  function statusBadge(status) {
    const map = {
      active:    "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
      invited:   "bg-amber-50 text-amber-700 ring-amber-600/20",
      suspended: "bg-rose-50 text-rose-700 ring-rose-600/20",
    };
    const cls = map[status] || "bg-gray-50 text-gray-700 ring-gray-500/20";
    return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}">${escapeHtml(status)}</span>`;
  }
  function roleBadge(role) {
    const cls = role === "owner"       ? "bg-aurum-gold/30 text-aurum-ink ring-aurum-gold/50"
              : role === "super_admin" ? "bg-aurum-gold/20 text-aurum-ink ring-aurum-gold/40"
              : role === "admin"       ? "bg-indigo-50 text-indigo-700 ring-indigo-600/20"
              : role === "manager"     ? "bg-sky-50 text-sky-700 ring-sky-600/20"
              : role === "operator"    ? "bg-teal-50 text-teal-700 ring-teal-600/20"
              :                          "bg-gray-50 text-gray-700 ring-gray-500/20";
    return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}">${escapeHtml(AurumPerms.ROLE_LABELS[role] || role)}</span>`;
  }

  // ---- SVG icons -----------------------------------------------------
  function iconDashboard() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5"><path d="M3 12l9-9 9 9M5 10v10h14V10" stroke-linejoin="round"/></svg>`; }
  function iconUsers()     { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5"><circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6M16 11a3 3 0 100-6M22 20c0-2.5-1.8-4.6-4-5.4" stroke-linecap="round"/></svg>`; }
  function iconCustomers() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" stroke-linecap="round"/><path d="M12 2v2M5.5 4.5l1.4 1.4M18.5 4.5l-1.4 1.4" stroke-linecap="round"/></svg>`; }
  function iconShield()    { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5"><path d="M12 3l8 3v6c0 4.5-3.2 8.3-8 9-4.8-.7-8-4.5-8-9V6l8-3z" stroke-linejoin="round"/></svg>`; }
  function iconActivity()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5"><path d="M3 12h4l2-6 4 12 2-6h6" stroke-linejoin="round" stroke-linecap="round"/></svg>`; }
  function iconSettings()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h0a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v0a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" stroke-linejoin="round" stroke-linecap="round"/></svg>`; }
  function iconAddCredit() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M8 15h3M14 15h.01" stroke-linecap="round"/><path d="M18 3v4M16 5h4" stroke-linecap="round"/></svg>`; }
  function iconRemoveCredit() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M8 15h3M14 15h.01" stroke-linecap="round"/><path d="M16 5h4" stroke-linecap="round"/></svg>`; }
  function iconCreditLog() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5"><path d="M5 3h11l3 3v15a0 0 0 010 0H5a0 0 0 010 0V3z" stroke-linejoin="round"/><path d="M9 9h6M9 13h6M9 17h4" stroke-linecap="round"/></svg>`; }
  function iconMt5()       { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5"><path d="M3 17l5-5 3 3 4-6 6 8" stroke-linejoin="round" stroke-linecap="round"/><circle cx="8" cy="12" r="1.4" fill="currentColor"/><circle cx="11" cy="15" r="1.4" fill="currentColor"/><circle cx="15" cy="9" r="1.4" fill="currentColor"/></svg>`; }
  function iconSubscriptions() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18" stroke-linecap="round"/><path d="M16.5 14.5a2 2 0 11-1.4-3.4M16.5 11v3.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`; }
  function iconBuyback()   { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5"><path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 8.7l5.4-.8z" stroke-linejoin="round"/><path d="M16.5 19.5h5M19 17v5" stroke-linecap="round"/></svg>`; }
  function iconHealth() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5"><path d="M3 12h4l2.2-5 3.4 10 2.2-5H21" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 22C6.5 19.1 3 15.8 3 10.8A5 5 0 0112 7a5 5 0 019 3.8c0 5-3.5 8.3-9 11.2z" opacity=".35"/></svg>`; }

  window.AurumUI = { renderShell, setSubtitle, toast, modal, escapeHtml, fmtDate, fmtRelative, statusBadge, roleBadge };

  window.AurumApp = {
    /**
     * boot(ctx) — called by every guarded page after AurumAuth.guard().
     * Renders shell and returns ctx for chaining.
     */
    boot(ctx) {
      renderShell(ctx);
      return ctx;
    },
  };
})();
