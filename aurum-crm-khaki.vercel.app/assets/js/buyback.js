// ====================================================================
// AURUM CRM — Buyback helpers + "create for customer" modal
// --------------------------------------------------------------------
// Shared by buybacks.html (list) and buyback-detail.html (detail).
//
// Everything talks to the admin_* RPCs, never to the tables directly:
// buyback_requests / stars_wallet / customers are all RLS "own row
// only", so a direct select would return just the admin's own rows.
// The RPCs are SECURITY DEFINER and re-check the caller's role
// server-side, so the UI gating here is convenience, not the boundary.
// ====================================================================

(function () {

  // Same short codes the creator-livetech buyback form sends.
  const BANKS = [
    { code: "SCB",   label: "SCB — ไทยพาณิชย์" },
    { code: "KBANK", label: "KBank — กสิกรไทย" },
    { code: "BBL",   label: "BBL — กรุงเทพ" },
    { code: "KTB",   label: "KTB — กรุงไทย" },
    { code: "BAY",   label: "BAY — กรุงศรีอยุธยา" },
    { code: "TTB",   label: "TTB — ทหารไทยธนชาต" },
    { code: "GSB",   label: "GSB — ออมสิน" },
    { code: "BAAC",  label: "BAAC — ธ.ก.ส." },
    { code: "CIMB",  label: "CIMB — ซีไอเอ็มบี ไทย" },
    { code: "UOB",   label: "UOB — ยูโอบี" },
    { code: "TISCO", label: "TISCO — ทิสโก้" },
    { code: "KKP",   label: "KKP — เกียรตินาคินภัทร" },
    { code: "LH",    label: "LH — แลนด์ แอนด์ เฮ้าส์" },
  ];

  const THB_PER_STAR = 3.00;
  const MIN_STARS    = 10;

  // ---- formatters ----------------------------------------------------

  function shortId(id) { return String(id || "").slice(0, 8); }

  function fmtThb(v) {
    const n = Number(v || 0);
    return "฿" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtBangkok(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short",
    }) + " (BKK)";
  }

  // "SCB ····7890"
  function fmtBank(bankName, accountNumber) {
    const bank = bankName || "—";
    const acct = String(accountNumber || "");
    if (!acct) return bank;
    return `${bank} ····${acct.slice(-4)}`;
  }

  function statusBadge(status) {
    const map = {
      pending:   "bg-amber-50 text-amber-700 ring-amber-600/20",
      approved:  "bg-sky-50 text-sky-700 ring-sky-600/20",
      paid:      "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
      rejected:  "bg-rose-50 text-rose-700 ring-rose-600/20",
      cancelled: "bg-gray-100 text-gray-600 ring-gray-500/20",
    };
    const cls = map[status] || "bg-gray-50 text-gray-700 ring-gray-500/20";
    const esc = window.AurumUI ? AurumUI.escapeHtml : (s) => s;
    return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}">${esc(status)}</span>`;
  }

  // ---- errors --------------------------------------------------------
  // The RPCs raise bare codes; map the ones an admin can act on and
  // surface anything else verbatim so it can be debugged.
  const ERROR_TEXT = {
    below_minimum:             `จำนวน stars ต้องอย่างน้อย ${MIN_STARS}`,
    insufficient_stars:        "ลูกค้ามี stars ไม่พอ",
    wallet_not_found:          "ลูกค้าไม่มี wallet",
    user_required:             "กรุณาเลือกลูกค้า",
    rejection_reason_required: "ต้องระบุเหตุผลในการปฏิเสธ",
    invalid_target_status:     "สถานะปลายทางไม่ถูกต้อง",
    not_found:                 "ไม่พบคำขอนี้",
    forbidden:                 "คุณไม่มีสิทธิ์ดำเนินการนี้ (ต้องเป็น admin หรือ super admin)",
    not_authenticated:         "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
  };

  function friendlyError(error, prefix) {
    const raw = String((error && error.message) || error || "").trim();
    for (const key of Object.keys(ERROR_TEXT)) {
      if (raw.includes(key)) return ERROR_TEXT[key];
    }
    if (raw.includes("invalid_transition")) {
      // Carries its own explanation after the colon.
      return `สถานะไม่ถูกต้องสำหรับการดำเนินการนี้ — ${raw.split("invalid_transition:").pop().trim()}`;
    }
    return `${prefix || "ดำเนินการไม่สำเร็จ"}: ${raw || "unknown error"}`;
  }

  // ---- overlay plumbing ----------------------------------------------
  // Same shape as the customers.html detail overlay: ESC to close,
  // click-outside to close, focus restored to the opener.

  function buildOverlay(innerHtml) {
    const lastFocus = document.activeElement;
    const wrap = document.createElement("div");
    wrap.className = "fixed inset-0 z-[998] flex items-center justify-center p-4 bg-gray-900/40 overflow-y-auto";
    wrap.innerHTML = innerHtml;
    document.body.appendChild(wrap);

    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); close(); return; }
      if (e.key !== "Tab") return;
      const f = wrap.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    function close() {
      document.removeEventListener("keydown", onKey, true);
      wrap.remove();
      if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
    }

    document.addEventListener("keydown", onKey, true);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    return { wrap, close };
  }

  // ---- create-for-customer modal --------------------------------------

  function openCreateModal({ onCreated } = {}) {
    const bankOptions = BANKS.map(b =>
      `<option value="${b.code}">${AurumUI.escapeHtml(b.label)}</option>`).join("");

    const { wrap, close } = buildOverlay(`
      <div class="w-full max-w-lg my-8 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden"
           role="dialog" aria-modal="true" aria-labelledby="bb-create-title">
        <div class="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <h3 id="bb-create-title" class="font-display text-lg font-semibold text-aurum-ink">Create buyback for customer</h3>
            <p class="text-xs text-gray-500 mt-0.5">Stars are deducted from the customer's wallet immediately.</p>
          </div>
          <button data-role="x" aria-label="Close" class="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
        </div>

        <div class="px-6 py-5 space-y-4">

          <div>
            <label for="bb-cust" class="block text-xs font-medium text-gray-600 mb-1">Customer email</label>
            <input id="bb-cust" type="search" autocomplete="off" placeholder="Type at least 2 characters…"
              class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus-aurum"/>
            <div data-role="cust-results" class="mt-1 border border-gray-100 rounded-lg divide-y divide-gray-100 hidden max-h-44 overflow-y-auto"></div>
            <div data-role="cust-chosen" class="mt-2 hidden rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-sm"></div>
          </div>

          <div>
            <label for="bb-stars" class="block text-xs font-medium text-gray-600 mb-1">Star amount</label>
            <input id="bb-stars" type="number" min="${MIN_STARS}" step="1" value="${MIN_STARS}"
              class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus-aurum tabular-nums"/>
            <p data-role="payout" class="text-xs text-gray-500 mt-1"></p>
          </div>

          <div>
            <label for="bb-bank" class="block text-xs font-medium text-gray-600 mb-1">Bank</label>
            <select id="bb-bank" class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus-aurum">
              ${bankOptions}
            </select>
          </div>

          <div>
            <label for="bb-acct" class="block text-xs font-medium text-gray-600 mb-1">Bank account number</label>
            <input id="bb-acct" type="text" inputmode="numeric" autocomplete="off" placeholder="10–15 digits"
              class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus-aurum tabular-nums"/>
          </div>

          <div>
            <label for="bb-holder" class="block text-xs font-medium text-gray-600 mb-1">Bank account holder name</label>
            <input id="bb-holder" type="text" autocomplete="off"
              class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus-aurum"/>
          </div>

          <div>
            <label for="bb-note" class="block text-xs font-medium text-gray-600 mb-1">Admin note <span class="text-gray-400">(optional)</span></label>
            <textarea id="bb-note" rows="2" placeholder="e.g. requested via LINE #12345"
              class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus-aurum"></textarea>
          </div>

          <p data-role="err" class="text-sm text-rose-600 hidden"></p>
        </div>

        <div class="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2">
          <button data-role="cancel" class="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
          <button data-role="submit" class="px-4 py-2 rounded-lg text-sm font-semibold bg-aurum-gold text-aurum-ink hover:brightness-95 disabled:opacity-50">
            Create request
          </button>
        </div>
      </div>`);

    const $ = (sel) => wrap.querySelector(sel);
    const custInput = $("#bb-cust");
    const results   = $('[data-role="cust-results"]');
    const chosenBox = $('[data-role="cust-chosen"]');
    const starsIn   = $("#bb-stars");
    const payoutEl  = $('[data-role="payout"]');
    const acctIn    = $("#bb-acct");
    const errEl     = $('[data-role="err"]');
    const submitBtn = $('[data-role="submit"]');

    let chosen = null;
    let searchSeq = 0;
    let searchTimer = null;

    function showErr(msg) {
      errEl.textContent = msg;
      errEl.classList.toggle("hidden", !msg);
    }

    // ---- live payout ----
    function paintPayout() {
      const n = parseInt(starsIn.value, 10);
      if (!Number.isFinite(n) || n <= 0) { payoutEl.textContent = ""; return; }
      payoutEl.innerHTML = `${n.toLocaleString()} stars × ฿${THB_PER_STAR.toFixed(2)} = <strong>${fmtThb(n * THB_PER_STAR)}</strong>`
        + (chosen && n > chosen.total_balance
            ? ` <span class="text-rose-600">— เกินยอดคงเหลือของลูกค้า (${chosen.total_balance})</span>` : "");
    }
    starsIn.addEventListener("input", paintPayout);
    paintPayout();

    // ---- digits-only account number ----
    acctIn.addEventListener("input", () => {
      acctIn.value = acctIn.value.replace(/[^0-9]/g, "").slice(0, 15);
    });

    // ---- customer autocomplete ----
    function paintChosen() {
      if (!chosen) { chosenBox.classList.add("hidden"); return; }
      chosenBox.classList.remove("hidden");
      chosenBox.innerHTML = `
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="font-medium text-aurum-ink truncate">${AurumUI.escapeHtml(chosen.email)}</div>
            <div class="text-xs text-gray-500">Wallet balance:
              <strong class="${chosen.total_balance > 0 ? "text-emerald-700" : "text-rose-600"}">${chosen.total_balance}</strong> stars
              ${chosen.has_wallet ? "" : ' <span class="text-rose-600">— ไม่มี wallet</span>'}
            </div>
          </div>
          <button data-role="clear" class="text-xs text-gray-500 hover:text-gray-800 underline shrink-0">Change</button>
        </div>`;
      chosenBox.querySelector('[data-role="clear"]').addEventListener("click", () => {
        chosen = null;
        paintChosen(); paintPayout();
        custInput.value = "";
        custInput.focus();
      });
      paintPayout();
    }

    custInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      const q = custInput.value.trim();
      if (q.length < 2) { results.classList.add("hidden"); results.innerHTML = ""; return; }
      searchTimer = setTimeout(() => runSearch(q), 300);
    });

    async function runSearch(q) {
      const seq = ++searchSeq;
      results.classList.remove("hidden");
      results.innerHTML = `<div class="px-3 py-2 text-xs text-gray-400">Searching…</div>`;

      const { data, error } = await sb.rpc("admin_search_buyback_customers", { p_search: q });
      if (seq !== searchSeq) return;

      if (error) {
        results.innerHTML = `<div class="px-3 py-2 text-xs text-rose-600">${AurumUI.escapeHtml(friendlyError(error, "ค้นหาไม่สำเร็จ"))}</div>`;
        return;
      }
      const list = (data && data.rows) || [];
      if (!list.length) {
        results.innerHTML = `<div class="px-3 py-2 text-xs text-gray-400">ไม่พบลูกค้าที่ตรงกับ “${AurumUI.escapeHtml(q)}”</div>`;
        return;
      }
      results.innerHTML = list.map((c, i) => `
        <button data-idx="${i}" class="w-full text-left px-3 py-2 hover:bg-gray-50 focus-aurum">
          <div class="text-sm text-aurum-ink truncate">${AurumUI.escapeHtml(c.email)}</div>
          <div class="text-xs text-gray-500">${c.total_balance} stars${c.has_wallet ? "" : " · ไม่มี wallet"}</div>
        </button>`).join("");
      results.querySelectorAll("[data-idx]").forEach(btn => {
        btn.addEventListener("click", () => {
          chosen = list[Number(btn.dataset.idx)];
          results.classList.add("hidden");
          results.innerHTML = "";
          custInput.value = chosen.email;
          showErr("");
          paintChosen();
        });
      });
    }

    // ---- submit ----
    $('[data-role="x"]').addEventListener("click", close);
    $('[data-role="cancel"]').addEventListener("click", close);

    submitBtn.addEventListener("click", async () => {
      showErr("");

      if (!chosen)            return showErr("กรุณาเลือกลูกค้า");
      if (!chosen.has_wallet) return showErr("ลูกค้าไม่มี wallet");

      const stars = parseInt(starsIn.value, 10);
      if (!Number.isFinite(stars) || stars < MIN_STARS) return showErr(ERROR_TEXT.below_minimum);
      if (stars > chosen.total_balance)                 return showErr(ERROR_TEXT.insufficient_stars);

      const acct = acctIn.value.replace(/[^0-9]/g, "");
      if (acct.length < 10 || acct.length > 15) return showErr("เลขบัญชีต้องมี 10–15 หลัก");

      const holder = $("#bb-holder").value.trim();
      if (!holder) return showErr("กรุณากรอกชื่อเจ้าของบัญชี");

      submitBtn.disabled = true;
      submitBtn.textContent = "Creating…";

      // admin_create_buyback stamps the note inside the same transaction,
      // so there is no separate follow-up UPDATE to leave half-applied.
      const { data, error } = await sb.rpc("admin_create_buyback", {
        p_user_id:             chosen.user_id,
        p_star_amount:         stars,
        p_bank_name:           $("#bb-bank").value,
        p_bank_account_number: acct,
        p_bank_account_name:   holder,
        p_admin_notes:         $("#bb-note").value.trim() || null,
      });

      submitBtn.disabled = false;
      submitBtn.textContent = "Create request";

      if (error) return showErr(friendlyError(error, "ไม่สามารถสร้างคำขอได้"));

      const requestId = data && data.request_id;
      AurumAuth.log("buyback.created", {
        resource_type: "buyback_request",
        resource_id:   requestId,
        metadata:      { user_id: chosen.user_id, star_amount: stars, total_thb: data && data.total_thb },
      });
      AurumUI.toast(`สร้างคำขอ buyback สำเร็จ (${shortId(requestId)})`, "success");
      close();
      if (onCreated) onCreated(requestId);
    });

    custInput.focus();
  }

  window.AurumBuyback = {
    BANKS, THB_PER_STAR, MIN_STARS,
    shortId, fmtThb, fmtBangkok, fmtBank, statusBadge,
    friendlyError, buildOverlay, openCreateModal,
  };
})();
