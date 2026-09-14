# Edge Function Audit — AURUM CRM

**Date:** 2026-09-14
**Project audited:** Supabase `hknvooaqgpufrbdxtzxf`
**Frontend:** `aurum-crm-khaki.vercel.app/` (nested folder at repo root — the Vercel Root Directory)
**Production:** `crm.creatorlivetech.com` (primary), `aurum-crm-khaki.vercel.app` (fallback)
**Status:** Discovery only. No code changed. No functions deployed.

---

## 1. Executive summary

Eight edge functions are referenced by the CRM frontend. **All eight are missing** from
`hknvooaqgpufrbdxtzxf`. Zero are deployed.

Three findings change the shape of the recovery work versus the original assumption:

1. **`crm-delete-customer` is also missing.** It was believed deployed and working. It is
   not. Verified twice — absent from the function list, and `get_edge_function` returns
   `NotFoundException`. The Delete Customer button on the Customers page is broken like
   the rest.

2. **No edge function source has ever existed in this repository.** Git history across all
   branches contains no `.ts` file and no `supabase/functions/` directory, at any commit.
   There is nothing to port. Every rebuild reconstructs its contract from the frontend
   call site.

3. **The database underneath is a different schema than the frontend expects.** This is the
   blocker. `hknvooaqgpufrbdxtzxf` carries the creator-platform schema (stars, THB,
   creators, creator subscriptions). The CRM frontend was written against an AURUM CRM
   schema (USD plans, MT5 accounts, customer credit). The tables the functions would need
   to read do not exist. Rebuilding a function against a table that isn't there produces a
   function that returns nothing.

The practical consequence: **the Customers page is already broken before any edge function
is called.** It reads `public.customer_profiles`, which does not exist. Rebuilding
`crm-customer-detail` and `crm-customer-subscriptions` would not make that page work,
because the customer list they enrich never renders. The schema gap has to be settled
first — it is a decision for CEO Por, not a coding task, and it is laid out in §6.

---

## 2. Method, and one correction to the brief

The brief asked for a grep of `supabase.functions.invoke(...)`. **That returns zero results
in this codebase.** This frontend does not use the Supabase JS client's `functions.invoke`
helper. It builds URLs by hand from `window.AURUM_CONFIG` and calls them with raw `fetch()`:

```js
function fnUrl() {
  const base = (window.AURUM_CONFIG.SUPABASE_URL || "").replace(/\/+$/, "");
  const path = window.AURUM_CONFIG.SUBS_FUNCTION_PATH || "/functions/v1/crm-subscriptions-list";
  return base + path;
}
```

The inventory below was instead built from the `*_FUNCTION_PATH` keys in
`assets/js/config.js` (lines 14–21), cross-checked against every `fetch(` call site in the
HTML. Worth recording because the same grep will come up empty on the sister repo too if it
shares this vintage.

Deployment state was read through the Supabase management API. Direct HTTPS probes of
`https://hknvooaqgpufrbdxtzxf.supabase.co/functions/v1/<slug>` were attempted first but this
environment's network policy refuses the CONNECT tunnel (403), so curl was not usable. The
management API is the stronger source anyway — it enumerates the project's functions rather
than inferring existence from a status code.

---

## 3. Frontend call inventory

All paths are relative to `aurum-crm-khaki.vercel.app/`. All eight calls send
`Authorization: Bearer <user JWT>`; all but `crm-signup-approval-mode` also send the `apikey`
header. None is called unauthenticated — **`verify_jwt: true` is correct for all eight.**

### 3.1 `crm-customer-detail` — P0

| | |
|---|---|
| **Called from** | `customers.html:980` (`loadDetail`), URL built at `:921` |
| **Route** | `/customers` → click a customer row → Customer Detail modal |
| **Request** | `GET ?user_id=<uuid>` (the `customer_profiles.id` of the clicked row) |
| **Response** | `{ ok, customer:{...}, subscriptions:[...], payments:[...] }` |

`customer` is consumed at `:999–1021`: `full_name`, `email`, `phone`, `status`,
`registered_at`, `verification_status` (`"verified"` compared literally),
`signup_mode` (`"auto"` \| `"manual"` \| null), `credit_usd`.

`subscriptions[]` at `:1100–1119`: `plan_name`, `plan_price_usd`, `plan_billing_cycle`,
`started_at`, `expires_at`, `status`, `auto_renew`.

`payments[]` at `:1131–1150`: `created_at`, `source` (`"inet"` switches the amount
formatting to THB), `wallet_type`, `amount_thb`, `amount_usd`, `status`, `notes`.

Errors are read as `out.detail || out.error`.

**Visible breakage:** the modal opens, shows its skeleton, then replaces it with
*"Couldn't load customer detail — HTTP 404"* and a Retry button that fails identically.

### 3.2 `crm-customer-subscriptions` — P0

| | |
|---|---|
| **Called from** | `customers.html:268` (`loadSubscriptions`), URL at `:251` |
| **Route** | `/customers` — runs on page load to enrich every row |
| **Request** | `GET`, no parameters. Returns the latest subscription for **all** customers at once. |
| **Response** | `{ ok, rows:[ { user_id, subscription_started_at, subscription_expires_at, subscription_status } ] }` |

Keyed into `subById` by `user_id`. Drives the Subscription column, the `days_left`
computation (`subDaysLeft`, `:289`), and the active/expiring/none stat buckets (`:298`).

**Visible breakage:** deliberately silent. The `catch` at `:284` leaves `—` placeholders and
the stat cards under-count. **Nothing tells CEO Por or Ice this data is missing** — the page
looks like every customer has no subscription. This is the most dangerous of the eight,
because it fails quietly and reads as fact.

### 3.3 `crm-subscriptions-list` — P0

| | |
|---|---|
| **Called from** | `subscriptions.html:183`, URL at `:149` |
| **Route** | `/subscriptions` (the whole page) |
| **Request** | `GET ?page=<n>&page_size=50[&plan_id=][&status=]` |
| **Response** | `{ ok, rows:[...], total:<int>, plans:[...], meta:{...} }` |

`rows[]` (`:263–281`, `planCell` at `:309`): `customer:{ full_name, email, matched }`, `plan:{ name, code,
price_usd, billing_cycle }`, `status`, `started_at`, `expires_at`, `auto_renew`.
`plans[]` (`:197`, `populatePlans` at `:216`): `id`, `name`, `code`, `billing_cycle` — populates the filter dropdown once.
`meta` (`:198`, `updateStats` at `:234`): `total_subscriptions`, `active_subscriptions`, `expired_subscriptions`,
`cancelled_subscriptions`, `auto_renew_on`.

**Visible breakage:** full-width red row — *"Couldn't load subscriptions — HTTP 404"* — plus
an error toast, zeroed stat cards, empty pager. Re-fires every 30s (`setInterval` at `:146`),
so the toast reappears indefinitely while the tab is open.

### 3.4 `crm-delete-customer` — P0 *(believed working; it is not)*

| | |
|---|---|
| **Called from** | `customers.html:602` (`callDeleteFn`), URL at `:592` |
| **Route** | `/customers` → row menu → Delete |
| **Request** | `POST {user_id}` twice: first `{user_id, preview:true}` (`:715`), then `{user_id, reason, force}` (`:814`) |
| **Response** | preview → `{ ok, preview:{ needs_force, active_subscription, credit_usd, mt5_count } }`; delete → `{ ok }`, or `{ error:"force_required" }`, or 404 when already gone |

Two-phase by design: a read-only preview decides whether the "type DELETE to confirm"
guard-rail appears, then the destructive call runs. The server is expected to re-check the
guard and answer `force_required` if the preview under-detected (`:836`).

**Visible breakage:** the preview 404s and falls back to client-side data
(`needs_force: false`, `:747`), so the modal opens looking normal. The actual delete then
fails with *"HTTP 404"*. Nothing is deleted — no data loss — but the operation is dead and
the failure only surfaces at the final click.

### 3.5 `crm-signup-approval-mode` — P1, **and currently unreachable**

| | |
|---|---|
| **Called from** | `settings.html:235` (GET) and `:258` (POST), URL at `:196` |
| **Route** | `/settings` → "Signup Approval Mode" section |
| **Request** | `GET` to read; `POST {mode:"auto"\|"manual"}` to write. No `apikey` header on either. |
| **Response** | `{ ok, config:{ mode } }` |

**This function cannot currently be called at all.** Line 191 gates the entire section:

```js
if (ctx.profile.role === "owner") { setupSignupApprovalMode(); }
```

`profiles_role_check` permits only `admin`, `super_admin`, `agent`, `viewer` — `owner` is not
a legal value, so no row can ever hold it. CEO Por's profile is `super_admin`. The section
never renders and the fetch never fires.

`assets/js/permissions.js:17` compounds this: it defines `ROLES = ["super_admin", "admin",
"manager", "operator", "viewer"]`. `manager` and `operator` are rejected by the same
constraint, and `agent` — which the database does allow — is missing from the list entirely.
The comment at `:12–16` says `owner` is deliberately excluded from `ROLES` because it sits
above `super_admin`; that intent never made it into the schema.

**Visible breakage:** none today — the feature is invisible. Rebuilding the function alone
changes nothing user-facing. It needs the role gate fixed in the same PR (widen to
`super_admin`, or add `owner` to the constraint and promote CEO Por). **This is a decision,
not a detail** — flagged for CEO Por in §6.

### 3.6 `invite-user` — P1

| | |
|---|---|
| **Called from** | `users.html:220`, URL at `:217` |
| **Route** | `/users` → "Invite user" modal |
| **Request** | `POST { email, full_name, role }` (email lower-cased and trimmed) |
| **Response** | `{ email_status:"sent"\|<other>, email_error? }` |

Toast text is built from `email_status` / `email_error` (`:241–245`), so the function is
expected to send the mail itself and report the outcome rather than throw. A temporary
password is promised in the modal copy (`:205`) and `must_change_pw` exists on `profiles`,
so the function must create the auth user with a temp password and set that flag.

Note the `role` sent comes from `AurumPerms.ROLES` — which can emit `manager` or `operator`,
both of which the CHECK constraint will reject. The rebuild must validate `role` against the
four legal values and return a clean error rather than surfacing a raw Postgres violation.

**Visible breakage:** *"Invite failed (404): ..."* toast; modal stays open. No new admin can
be onboarded — Ice's account cannot be created this way.

### 3.7 `delete-user` — P1

| | |
|---|---|
| **Called from** | `users.html:355`, URL at `:352` |
| **Route** | `/users` → row → Delete (requires typing the email to confirm) |
| **Request** | `POST { user_id }` |
| **Response** | success = HTTP 2xx; only `out.error` is read on failure |

Comment at `:329–332` states the contract: remove the auth user, the `profiles` row, and any
pending invitations in one shot, with activity logging server-side. It deletes an **admin**,
not a customer — distinct from `crm-delete-customer`.

**Visible breakage:** *"Delete failed (404): ..."*; the user remains.

### 3.8 `admin-mt5-connections` — P2

| | |
|---|---|
| **Called from** | `mt5-connections.html:192`, URL at `:161` |
| **Route** | `/mt5-connections` (the whole page) |
| **Request** | `GET ?limit=<n>&offset=<n>[&broker=][&include_master=true]` |
| **Response** | `{ ok, rows:[...], total }` |

`rows[]`: `email`, `full_name`, `broker_name`, `is_master_owner`, `metaapi_state`,
`subscription_status`, `created_at`, `updated_at`, plus MT5 account fields.

**Visible breakage:** red error row across the table, error toast, re-fires every 30s.

---

## 4. Deployment reality check

`hknvooaqgpufrbdxtzxf` hosts **29 active edge functions**. Not one is a CRM function. The
deployed set belongs to the creator-livetech consumer platform: `init-signup`,
`complete-signup`, `resend-code`, `wallet-*` (4), `admin-credit-stars`,
`cron-star-expirations`, `create-payment-intent`, `buyback-request`, `stripe-webhook`,
`send-*` (4), `aurum-star`, `content-*` (3), `live-*` (7), `check-platform-budget`,
`alert-delivery-cron`.

| Function | State | Evidence |
|---|---|---|
| `crm-customer-detail` | **MISSING** | absent from list; `get_edge_function` → `NotFoundException` |
| `crm-customer-subscriptions` | **MISSING** | absent from list |
| `crm-subscriptions-list` | **MISSING** | absent from list |
| `crm-delete-customer` | **MISSING** | absent from list; `get_edge_function` → `NotFoundException` |
| `crm-signup-approval-mode` | **MISSING** | absent from list |
| `invite-user` | **MISSING** | absent from list |
| `delete-user` | **MISSING** | absent from list |
| `admin-mt5-connections` | **MISSING** | absent from list |

**DEPLOYED: 0 · MISSING: 8 · STALE: 0**

No STALE case arises — the `content-bunny-webhook` pattern (deployed but serving an old
bundle) needs something deployed to go stale, and nothing is.

### On PR #21

The brief credits `crm-delete-customer` to PR #21 of this repository. **This repository has
only ever had one pull request — PR #1**, the buyback admin panel, merged 2026-08-28
(`0b70aa5`). There is no PR #21 here. Whatever PR #21 was, it belongs to another repository
(most likely `creator-livetech` or the sister CRM), and no `crm-delete-customer` ever reached
this Supabase project. This is the clearest evidence that the Aug 8 migration notes track
intent rather than what landed.

---

## 5. Source recovery check

**Nothing is recoverable. Every rebuild is from-scratch, contract-derived.**

```
git log --all --full-history --oneline -- '*supabase/functions*'   → (empty)
git log --all --full-history --oneline -- '*.ts'                   → (empty)
```

The complete set of files git has ever tracked, across every branch and every commit, is 29
files: 2 workflows, 1 SQL migration, and the 26 files under `aurum-crm-khaki.vercel.app/`.
No TypeScript, ever. The edge functions were authored in the Supabase dashboard against the
old project (`jdelizsmiwpushoeafen`) and never committed here.

The old project is dead, so its bundles cannot be exported either. The frontend call sites
documented in §3 are the only surviving specification — which is why §3 records exact field
names and line numbers rather than summaries.

**Recommendation:** Phase 2 PRs should commit source under `supabase/functions/<slug>/` at
the **repo root**, alongside `db/`, deliberately outside `aurum-crm-khaki.vercel.app/` so
Vercel never serves it — the same placement PR #1 used for `db/migrations/`. That stops this
recurring.

---

## 6. The blocker: schema mismatch

This is the finding that should drive the Phase 2 decision, and it was not visible from the
Aug 8 notes.

`config.js` was repointed at `hknvooaqgpufrbdxtzxf` on 2026-08-08 (`f042a63`), but the pages
still speak the old CRM's schema. The tables they need are not there:

| Frontend expects | Exists on `hknvooaqgpufrbdxtzxf`? |
|---|---|
| `customer_profiles` | **No** — not in any schema |
| `activity_logs` | **No** — `AurumAuth.log()` silently no-ops everywhere |
| `admin_notifications` | **No** |
| `mt5_connections` (or any MT5 table) | **No** |
| `customers` | Yes — but a different shape |
| `subscriptions` / `subscription_plans` | Yes — but a different domain |

**The Customers page is broken at the table layer, not the function layer.**
`customers.html:193` selects
`id,email,full_name,phone,mt5_account,broker,status,is_verified,registered_at,last_login_at`
from `customer_profiles`. The real `customers` table has
`id, user_id, email, phone, phone_verified_at, email_verified_at, role, created_at, updated_at`
— no `full_name`, no `status`, no `is_verified`, no `registered_at`, no MT5 columns. The page
renders a red error row from `:203` and the customer list is empty. **Neither
`crm-customer-detail` nor `crm-customer-subscriptions` can be exercised at all until that is
resolved**, because both are reached from rows that never render.

The subscription domain differs just as sharply. The CRM page is titled *"Real subscribers
across all AURUM AI products"* and wants `plan_price_usd` and `plan_billing_cycle`. The real
`subscriptions` table is creator-fan: `subscriber_id → creator_id`, priced in `price_stars`
and `price_thb`, and `subscription_plans` has no `billing_cycle` and no USD column at all.
There is no honest mapping from one to the other — it is a product question about what the
CRM is now supposed to show.

Two further constraints a rebuild must respect:

- **RLS.** `customers` has `crm_admin_read_all_customers` using `is_crm_admin()` (which
  accepts `super_admin`/`admin`), so an admin JWT can read all customers. **`subscriptions`
  has no such policy** — only own-row-as-subscriber and own-row-as-creator. A function
  reading `subscriptions` under the caller's JWT returns zero rows for an admin. It needs
  `service_role`, or `SECURITY DEFINER` RPCs behind an admin gate, the approach PR #1 chose.
- **Vault reads** must use the `get_vault_secret(...)` RPC. It exists in `public` on this
  project and is the correct pattern; `.schema('vault')` is the failure mode that hid the
  Bunny webhook breakage for two weeks.

Also confirmed: `admin_notifications` does **not** exist, and **nothing in the frontend
references it** — no page queries it and no call site expects it. It blocks no P0 flow, so it
stays out of scope, as the brief anticipated.

---

## 7. Priority classification

**P0 — daily-ops blocker**
- `crm-customer-detail` — support cannot open a customer
- `crm-customer-subscriptions` — fails **silently**; the Customers page misreports subscription state as if it were true
- `crm-subscriptions-list` — `/subscriptions` is dead
- `crm-delete-customer` — **reclassified from "working" to P0-missing**

**P1 — admin / config**
- `invite-user` — no new admin can be onboarded
- `delete-user` — no admin can be removed
- `crm-signup-approval-mode` — small, but **unreachable behind an impossible role check**; needs the gate fixed too

**P2 — trading-specific, deprecated**
- `admin-mt5-connections` — MT5, per the Jul 22 pivot away from trading products

**Recommendation on P2: do not rebuild.** Beyond the deprecation, there is no MT5 table
anywhere on `hknvooaqgpufrbdxtzxf` — rebuilding means designing and migrating an entire
schema for a product line being retired. The cheaper honest fix is to hide
`/mt5-connections` from the nav. Not touched without CEO Por's explicit yes, per the brief.

---

## 8. Proposed rebuild order

The brief's default order is sound for P1/P2 but **cannot be executed as written for P0**,
because items 1–3 all sit on top of the unresolved schema gap. Revised:

**Step 0 — settle the customer data model (decision, then one PR).** Not optional and not
deferrable: it gates all three P0 functions. The realistic options —

- **(a) Map the CRM onto the real schema.** Point `customers.html` at `customers`, drop the
  columns that no longer exist (`mt5_account`, `broker`, `is_verified` → derive from
  `email_verified_at`/`phone_verified_at`), and accept that `full_name` and `status` have no
  home until added. Cheapest; changes what the page shows.
- **(b) Add a `customer_profiles` view/table over `customers`.** Keeps the frontend
  untouched, synthesises the missing columns, and adds real ones for `full_name`/`status`.
  More DB work, no frontend churn, preserves the legacy CRM look the brief wants kept.
- **(c) Establish where AURUM AI product subscriptions actually live.** If those records are
  on a system that still exists, the P0 subscription functions should read *that*, and
  `hknvooaqgpufrbdxtzxf`'s creator subscriptions are the wrong source entirely.

**(b) is the recommendation** for the customer side — it matches the "legacy CRM stays
visually as-is" constraint and keeps the blast radius in the database. But **(c) needs CEO
Por's answer before either subscription function can be built**, because nothing here
determines which subscriptions the CRM is meant to display.

Then, one PR each:

1. **`crm-customer-detail`** — restores the highest-value support action once Step 0 lands.
2. **`crm-customer-subscriptions`** — depends on the (c) answer. Prioritised second despite
   being silent precisely *because* it is silent: wrong-looking data is worse than an error.
3. **`crm-subscriptions-list`** — same data source as 2, so it follows cheaply.
4. **`crm-delete-customer`** — P0 but last of the P0s: it destroys data, the two-phase
   preview/force contract deserves care, and it should be built once the customer model is
   settled rather than twice.
5. **`crm-signup-approval-mode`** — small and isolated, **plus** the role-gate fix
   (`settings.html:191` and the `permissions.js` role list) in the same PR.
6. **`invite-user`** then **`delete-user`** — admin lifecycle, paired; both need
   `service_role` for `auth.admin`, and `invite-user` needs role validation against the
   CHECK constraint.
7. **`admin-mt5-connections`** — **do not build.** Recommend retiring the page instead.

Deviations from the brief's default order, and why: `crm-delete-customer` is new to the list
(§4); it is sequenced after the read-only P0s because it is destructive and benefits from a
settled schema; and Step 0 is inserted ahead of everything because items 1–3 cannot be
tested against a page that does not render.

---

## 9. Gates

There is **no `package.json`, no build step, no linter, no test suite, and no CI beyond two
mirror workflows** (`mirror-to-gitlab.yml`, `mirror-secondary.yml`) that force-push every
branch to GitLab and a secondary host on each push. Nothing validates a change before it
lands. Phase 2 verification is therefore manual, against the live CRM, exactly as the brief
specifies — there is no automated gate to lean on, and none should be assumed.

`vercel.json` sets `cleanUrls: true`, so pages are served extensionless (`/customers`,
`/subscriptions`) while detail views keep query params (`buyback-detail.html?id=...`).

---

## 10. Verification log

| Check | Method | Result |
|---|---|---|
| Deployed functions | `list_edge_functions` on `hknvooaqgpufrbdxtzxf` | 29 active, 0 CRM |
| `crm-customer-detail` absent | `get_edge_function` | `NotFoundException` |
| `crm-delete-customer` absent | `get_edge_function` | `NotFoundException` |
| HTTPS probe of `/functions/v1/*` | `curl` | Not possible — network policy refuses CONNECT (403) |
| Source in history | `git log --all --full-history` for `*.ts`, `*supabase/functions*` | No match, ever |
| PR #21 | `list_pull_requests` state=all | Only PR #1 exists |
| `customer_profiles` | `information_schema.tables` | Not found in any schema |
| `activity_logs`, `admin_notifications`, MT5 tables | `information_schema.tables` | Not found |
| `profiles` roles | `pg_constraint` | `admin, super_admin, agent, viewer` — `owner` illegal |
| CEO Por's role | `select … from profiles` | `super_admin`, active — sole profile row |
| RLS on read targets | `pg_policies` | `customers` admin-readable; `subscriptions` own-row only |
| `get_vault_secret` | `pg_proc` | Exists in `public` |
| Repo gates | `package.json`, `.github/workflows/` | None; mirrors only |

---

## 11. Scope note

Discovery only, per the brief. No code changed, no function deployed, no migration applied,
no schema modified. `config.js`, `profiles`, RLS and the auth flow were read but not touched.
Every database call in this audit was a read.

**Phase 2 is blocked pending CEO Por's confirmation** of the priority order and, critically,
of the Step 0 data-model decision in §8.
