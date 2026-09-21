# NovaPay — Firebase Spark (real payments + manual credit)

Pure **HTML / CSS / JavaScript + Firebase Spark** (Auth, Firestore, Hosting).  
**No Cloud Functions.**

## How money works on this build

1. User pays with **real** Paystack / Flutterwave / Kora / MoonPay (public keys only).
2. App creates a **pending** record in Firestore (`deposits` + `transactions`).
3. **Balance is NOT increased by the app.**
4. You (admin) confirm the payment in the provider dashboard, then **manually credit** `balanceUSD` in Firebase Console.

This keeps payments real while staying on Spark without server secrets.

---

## Deploy

```bash
npm i -g firebase-tools
firebase login
firebase use YOUR_PROJECT_ID
```

1. Enable **Authentication** (Email/Password + Google), **Firestore**, **Hosting**.
2. Edit `public/app.js` config:
   - `PAYSTACK_PUBLIC_KEY` — Paystack **public** key (`pk_...`)
   - `FLW_PUBLIC_KEY` — Flutterwave **public** key
   - `KORA_PUBLIC_KEY` — Kora public key (optional)
   - `MOONPAY_API_KEY` — MoonPay publishable key
   - `COMPANY_DEPOSIT_ADDRESS` — wallet that receives crypto
   - `SUPPORT` links (optional)
3. Deploy:
   ```bash
   firebase deploy --only firestore:rules,hosting
   ```
4. Auth → Authorized domains: add your live domain.
5. Optional: Firestore doc `config/app` → `{ "usdNgn": 1600 }`.

---

## Admin: how to credit a deposit (manual)

### Step 1 — See pending deposits
Firebase Console → **Firestore** → collection **`deposits`**  
Filter or sort by `status == pending_review`.

Each doc has:
- `uid`, `email`, `displayName`
- `amountUSD`, `amountNGN`
- `provider` (paystack / flutterwave / kora)
- `reference` (match this in the payment dashboard)
- `note`, `createdAt`

### Step 2 — Confirm the payment is real
| Provider | Where to check |
|----------|----------------|
| Paystack | Dashboard → Transactions → search by `reference` |
| Flutterwave | Dashboard → Transactions → search by `tx_ref` |
| Kora | Kora dashboard / bank statement |
| MoonPay / on-chain | MoonPay dashboard or blockchain explorer |

Only credit if status is **successful** and amount matches.

### Step 3 — Credit the user balance
1. Firestore → **`users`** → open document with that `uid`
2. Edit field **`balanceUSD`**:
   - New value = current balance + `amountUSD` from the deposit
3. Save

### Step 4 — Mark deposit completed
1. Open the **`deposits`** document
2. Change `status` from `pending_review` → **`completed`**
3. (Optional) same for the related **`transactions`** row if you want history to show completed

### Step 5 — Withdrawals & crypto
- **`withdrawals`** with `pending_review` → send money, then set status `completed` or `rejected` (if rejected, add balance back).
- **`blockchainDeposits`** → verify TX on explorer, then add to `users/{uid}.assets.USDT` (or relevant asset) and mark completed.

---

## User experience

- After checkout: *“Payment submitted. Balance will update after admin confirmation.”*
- History shows amount with **(pending)** until you complete the deposit.
- Trading / swap still use the user’s current wallet balances (client-side on Spark).

---

## Security note

- Users cannot force a “completed” deposit via the app (rules require `pending_review` on create).
- They *can* still edit their own `users` document on Spark if they abuse the client.  
  For serious production volume, upgrade to **Blaze** + Cloud Functions so only the server can change balances.

---

## Composite indexes

If Firestore prompts you, create:

- `transactions`: `uid` Asc, `createdAt` Desc  
- `deposits`: `uid` Asc, `createdAt` Desc (optional)  
- `notifications`: `uid` Asc, `createdAt` Desc (optional)

---

## Files

| File | Role |
|------|------|
| `public/index.html` | UI |
| `public/styles.css` | Design |
| `public/app.js` | Client logic + payments |
| `firestore.rules` | Spark rules (pending deposits) |
| `firebase.json` | Hosting + Firestore |

`functions/` is unused on Spark.

## Admin steps

See **[ADMIN_CREDIT.md](./ADMIN_CREDIT.md)** for the exact console clicks to credit deposits, withdrawals, and orders.

