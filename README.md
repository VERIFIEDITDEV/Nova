# NovaPay (fixed)

Frontend: `public/` (static). Backend: Firebase Auth + Firestore + Cloud Functions (`functions/`).
All money logic (balances, prices, fees, orders, withdrawals) runs in Cloud Functions. The browser cannot change a balance.

## Deploy
1. `npm i -g firebase-tools && firebase login && firebase use usdt-invest-2209`
2. Upgrade the project to the **Blaze** plan (Cloud Functions + outbound calls to Paystack/Binance need it).
3. Secrets:
   `firebase functions:secrets:set PAYSTACK_SECRET`   (Paystack **secret** key)
   `firebase functions:secrets:set FLW_SECRET`        (Flutterwave secret key)
   `firebase functions:secrets:set FLW_WEBHOOK_HASH`  (any long random string; paste the same value in the Flutterwave dashboard)
4. Put your Flutterwave **public** key in `public/app.js` (`FLW_PUBLIC_KEY`) and your real support links in `SUPPORT`.
5. `cd functions && npm install && cd ..`
6. `firebase deploy` (it will ask for `DEPOSIT_ADDRESS`: your company EVM wallet that receives on-chain deposits).
7. Webhooks (needed so payments credit even if the customer closes the tab):
   - Paystack → Settings → API & Webhooks → `https://us-central1-usdt-invest-2209.cloudfunctions.net/paystackWebhook`
   - Flutterwave → Settings → Webhooks → `https://us-central1-usdt-invest-2209.cloudfunctions.net/flutterwaveWebhook`
8. Rates + admin (once): download a service-account key (keep it OUT of this folder), then
   `export GOOGLE_APPLICATION_CREDENTIALS=/path/key.json`
   `node scripts/admin-tools.js set-config 1600 1 0`   (USD→NGN rate, swap/trade fee %, gift-card markup %)
   `node scripts/admin-tools.js make-admin you@example.com`
   The app refuses trades/orders until `set-config` has been run. Update the rate whenever the market moves.
9. Firebase console → Authentication → Settings → Authorized domains: add your live domain.

## Daily operations (via Firebase console or the admin callables)
- Gift cards / shop orders: `orders` with `pending_fulfilment` → `resolveOrder` (`fulfill` + note with the code/tracking, or `refund`).
- Withdrawals: `withdrawals` with `pending_review` → send the payout, then `resolveWithdrawal` (`complete` or `reject` = refund).
- On-chain deposits: `blockchainDeposits` with `pending_review` → `resolveBlockchainDeposit` (`approve` credits the wallet).
- `setUserStatus`, `setUserWarning`, `setConfig` for bans, warnings, rates.

## Not built (needs a third party, cannot be faked in code)
Face/ID verification (KYC provider), automatic gift-card code delivery (supplier API), referral payouts (business rules), an admin web panel.
