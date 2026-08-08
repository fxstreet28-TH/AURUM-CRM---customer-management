# API Contract — Manual Add Credit

> Frontend contract for the **Add Credit** + **Credit Log** pages in
> `aurum-crm`. Backend implementation lives in the **`aurum-wallet-api`**
> repo and is the responsibility of the next session.
>
> Until the backend is deployed and `assets/js/config.js → WALLET_API_URL`
> is set, both pages render but every API call surfaces a clear error
> ("WALLET_API_URL is not configured" / network errors). The pages do
> NOT crash and do NOT fall back to writing wallet state directly via
> the Supabase anon key.

---

## Auth

All endpoints require:

```
Authorization: Bearer <supabase-access-token>
```

The frontend calls `sb.auth.getSession()` to fetch the access token of
the currently signed-in CRM admin. Backend MUST verify the JWT against
the same Supabase project (`SUPABASE_URL` in `assets/js/config.js`) and
MUST additionally check that the caller's email matches the hardcoded
super-admin (`porforex599@gmail.com`). The frontend gates UI on this
email but the backend is the source of truth.

CORS: backend must allow the CRM origin (Vercel preview + production)
with credentials disabled and the `Authorization` header allowlisted.

---

## Configuration knobs (frontend)

`assets/js/config.js`:

| Key                  | Notes                                                      |
| -------------------- | ---------------------------------------------------------- |
| `WALLET_API_URL`     | Base URL of `aurum-wallet-api`, no trailing slash. Empty by default. |
| `SUPER_ADMIN_EMAIL`  | Hardcoded `porforex599@gmail.com`; gates the sidebar items and `/add-credit` + `/credit-log` route guard. |

`vercel.json` CSP `connect-src` already allows `https://*.vercel.app`
and `https://*.aurumlive.com`. If the backend deploys to a different
host, update the CSP.

---

## Endpoint 1 — Search customers

```
GET /api/admin/customers/search?q={query}
```

| Param | Type   | Notes                                                |
| ----- | ------ | ---------------------------------------------------- |
| `q`   | string | Trim + lowercase. Match against `email` or `name` (case-insensitive substring). Frontend only fires for `q.length ≥ 2`. |

Returns up to ~20 candidates ordered by best match.

**Response 200**

```json
{
  "customers": [
    {
      "id":      "uuid",
      "email":   "user@example.com",
      "name":    "Jane Doe",
      "balance": 0.00
    }
  ]
}
```

`balance` is the customer's current USD wallet balance. It is shown
inline in the dropdown and again in the "Selected customer" card.

**Response 4xx/5xx** — any non-2xx body MUST include
`{ "error": "<short message>" }`.

---

## Endpoint 2 — Upload proof image

```
POST /api/admin/upload-proof
Content-Type: multipart/form-data
```

Form field: `image` — one file. Frontend validates client-side:

- MIME: `image/jpeg`, `image/png`, `image/webp`
- Size: ≤ 5 MB

Backend SHOULD re-validate. Recommended storage: a private Supabase
Storage bucket (e.g. `manual-credit-proofs/`) with a server-issued
signed URL or a public policy scoped to admins.

**Response 200**

```json
{ "url": "https://<project>.supabase.co/storage/v1/object/.../proof_xxx.jpg" }
```

The URL must be GET-able by the CRM admin's browser (the Credit Log
page renders `<img src=url>` thumbnails). If the bucket is private,
return a long-lived signed URL.

**Response error** — `{ "error": "..." }` with non-2xx status.

---

## Endpoint 3 — Add credit

```
POST /api/admin/add-credit
Content-Type: application/json
```

**Request body**

```json
{
  "customer_id":     "uuid",
  "amount_usd":      35.00,
  "reason":          "Crypto deposit OxaPay TX hash xyz",
  "proof_image_url": "https://...supabase.co/storage/.../proof_xxx.jpg"
}
```

Frontend constraints already enforced:

- `0.01 ≤ amount_usd ≤ 10000`
- `reason.trim().length ≥ 10`
- `proof_image_url` is the URL returned by Endpoint 2.

Backend MUST:

1. Verify caller is the hardcoded super admin.
2. Re-validate the bounds above.
3. Atomically credit the wallet AND insert a row into the manual
   credit log (Endpoint 4 reads from this table).
4. Be idempotent if the same `(customer_id, proof_image_url, reason)`
   triple is submitted twice — return the existing transaction.

**Response 200 (success)**

```json
{
  "ok": true,
  "transaction_id": "uuid",
  "new_balance": 35.00
}
```

**Response 200 with `ok:false`, OR 4xx (error)**

```json
{
  "ok": false,
  "error": "customer_not_found"
}
```

Suggested error codes the frontend already shows verbatim:

- `customer_not_found`
- `invalid_amount`
- `invalid_proof_url`
- `forbidden`
- `internal_error`

---

## Endpoint 4 — Get credit log

```
GET /api/admin/credit-log?page=1&limit=20&email=&from=&to=
```

| Param   | Type     | Notes                                                         |
| ------- | -------- | ------------------------------------------------------------- |
| `page`  | int ≥ 1  | 1-indexed.                                                    |
| `limit` | int      | Frontend always sends `20`. Backend MAY cap at `100`.         |
| `email` | string?  | Case-insensitive substring match on customer email.           |
| `from`  | `YYYY-MM-DD`? | Inclusive lower bound on `created_at` (UTC midnight).    |
| `to`    | `YYYY-MM-DD`? | Inclusive upper bound on `created_at` (UTC end-of-day).  |

Sorted by `created_at desc`.

**Response 200**

```json
{
  "logs": [
    {
      "id":              "uuid",
      "created_at":      "2026-05-07T14:00:00Z",
      "customer_email":  "user@example.com",
      "amount_usd":      35.00,
      "reason":          "Crypto deposit OxaPay TX hash xyz",
      "proof_image_url": "https://...supabase.co/storage/.../proof_xxx.jpg",
      "added_by_email":  "porforex599@gmail.com"
    }
  ],
  "total": 100,
  "page":  1
}
```

`total` is the total count across all pages with the given filters
(used to render pagination).

---

## Frontend → Endpoint mapping

| File              | Endpoint(s)                                |
| ----------------- | ------------------------------------------ |
| `add-credit.html` | 1 (search) → 2 (upload) → 3 (add credit)   |
| `credit-log.html` | 4 (list)                                   |

After a successful add, the page also writes a self-attributed row
into Supabase `activity_logs` via `AurumAuth.log("admin.credit_added", …)`
so the action shows up in the existing CRM activity feed.

---

## Open questions for the backend session

1. **Storage bucket name + visibility** for proof images.
2. **Wallet table** — is there an existing `customer_wallets` row per
   customer or is the balance derived from a transactions table?
3. **Idempotency key** — should the frontend send a client-generated
   UUID, or is `(customer_id, proof_image_url)` enough? (Current
   contract assumes the latter.)
4. **OxaPay reconciliation later** — when the webhook is fixed in
   Phase 2, manual credit rows must NOT be re-credited if the same
   TX hash arrives. Recommend storing the TX hash in `reason` AND a
   structured `metadata` column.
