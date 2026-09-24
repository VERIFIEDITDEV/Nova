# Admin guide — credit deposits (Spark / manual)

NovaPay on Spark does **not** auto-credit balances after payment.
You confirm the payment is real, then credit the user in Firebase Console.

---

## 1. Find pending deposits

Firebase Console → **Firestore** → collection **`deposits`**

Look for documents where:
- `status` = `pending_review`

Each document includes:
| Field | Meaning |
|--------|---------|
| `uid` | User ID (path to `users/{uid}`) |
| `email` | User email |
| `displayName` | Name |
| `amountUSD` | Amount to add to balance |
| `amountNGN` | Approx NGN charged |
| `provider` | paystack / flutterwave / kora |
| `reference` | Match this in the payment dashboard |
| `note` | Extra context |
| `createdAt` | When the user paid / submitted |

Also check **`blockchainDeposits`** for crypto TX hashes.

---

## 2. Confirm the payment is real

| Provider | Where to verify |
|----------|-----------------|
| **Paystack** | Dashboard → Transactions → search by `reference` → status must be **success** |
| **Flutterwave** | Dashboard → Transactions → search by `tx_ref` / reference → **successful** |
| **Kora** | Kora dashboard or bank statement |
| **MoonPay** | MoonPay dashboard |
| **On-chain** | Explorer (Etherscan, BscScan, Solscan…) — confirm TX to your company address, amount, confirmations |

**Do not credit** if status is failed, abandoned, or amount does not match.

---

## 3. Credit the user balance

1. Firestore → **`users`** → open document whose ID = deposit `uid`
2. Find field **`balanceUSD`**
3. Set new value = **current value + deposit `amountUSD`**
   - Example: balance was `12.50`, deposit `10.00` → set `22.50`
4. Save

For crypto on-chain (after you verified the TX):
- Edit `assets.USDT` (or BTC / ETH / …) the same way — add the received amount.

---

## 4. Mark the deposit completed

1. Open the **`deposits`** document again
2. Change `status` from `pending_review` → **`completed`**
3. Optional: add field `creditedAt` (timestamp) or `adminNote`
4. Optional: find related row in **`transactions`** (same `reference` or `depositId`) and set `status` to `completed`, and update `amountDisplay` to drop “(pending)”

The user will see balance update live (Firestore listener) and pending panel will clear on refresh.

---

## 5. Withdrawals

Collection **`withdrawals`**, status `pending_review`:

1. Send the payout (bank / crypto) yourself.
2. Set status to **`completed`**.
3. If you reject: set status **`rejected`** and **add the amount back** to the user’s balance (it was already deducted when they requested withdrawal).

---

## 6. Gift card / shop orders

Collection **`orders`**, status `pending_fulfilment`:

1. Fulfil via Tremendous (or supplier) or manually.
2. Set status **`completed`** and store code/tracking in a note field.
3. If you cannot fulfil: set **`refunded`** and add `totalUSD` back to `users/{uid}.balanceUSD`.

---

## Tips

- Always match **`reference`** before crediting.
- Prefer one admin Google account for the Console.
- Set a Google Cloud **budget alert** if you later upgrade to Blaze.
- Create a Firestore composite index if the console prompts you for `deposits`: `uid` ASC + `status` ASC + `createdAt` DESC.

## Security note

On Spark, a technical user could still try to raise their own `balanceUSD` in the client.
For higher security later, move credits to Cloud Functions (Blaze) or an external Worker that only the admin/webhook can call.


## Unified cash (USD + USDT) — important

Cash is **one pool**:
- `balanceUSD` + `assets.USDT` are treated as the **same money** (1:1).
- The app shows **Cash (USD/USDT)** = sum of both.
- Trading, gifts, and USDT withdrawals debit this combined cash.
- **Always credit new deposits to `balanceUSD` only** (leave `assets.USDT` at 0 unless the user already had USDT).

### Fiat / card deposit credit
```
users/{uid}.balanceUSD  →  old + amount
```

### Crypto deposit credit
- If they sent **USDT**: add to `balanceUSD` (same as cash)
- If they sent **BTC / ETH / BNB / LTC / TRX**: add to `assets.BTC` (etc.) only  
  Do **not** also add the USD value to `balanceUSD` (that would double-count).

### Check
Home → Cash should equal balanceUSD + assets.USDT  
Portfolio ≈ Cash + (crypto × live price)
