import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, onAuthStateChanged, signOut, updateProfile
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import {
  getFirestore, doc, updateDoc, collection, query, where, orderBy, limit, getDocs, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-functions.js';

// ------------------------------------------------------------------ CONFIG (edit these)
const firebaseConfig = {
  apiKey: 'AIzaSyC1TfGUijMt5udy44nfaufnHrtnv-oLdz8',
  authDomain: 'usdt-invest-2209.firebaseapp.com',
  projectId: 'usdt-invest-2209',
  storageBucket: 'usdt-invest-2209.firebasestorage.app',
  messagingSenderId: '168346609720',
  appId: '1:168346609720:web:7e135d2ecf104fe539decd'
};
const FLW_PUBLIC_KEY = 'FLWPUBK_TEST_REPLACE_ME'; // Flutterwave PUBLIC key only. Paystack needs no key in the browser.
const SUPPORT = { telegram: '', x: '', tiktok: '' }; // put your real profile URLs here; empty ones are hidden
const BINANCE_REST = 'https://data-api.binance.vision/api/v3';
const BINANCE_WS = 'wss://data-stream.binance.vision/ws';

// ------------------------------------------------------------------ setup + helpers
const app = initializeApp(firebaseConfig);
const auth = getAuth(app), db = getFirestore(app), fn = getFunctions(app, 'us-central1'), google = new GoogleAuthProvider();

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(Number(n || 0));
const call = (name, payload) => httpsCallable(fn, name)(payload).then(r => r.data);
const err = e => String(e?.message || 'Request failed').replace('Firebase: ', '');
const msg = (el, text, cls = '') => { el.textContent = text; el.className = 'status show ' + cls; };
let toastTimer;
function toast(t) { const e = $('toast'); e.textContent = t; e.className = 'toast'; clearTimeout(toastTimer); toastTimer = setTimeout(() => (e.className = ''), 3000); }

let me = null, data = null, unsub = null, catalog = null, signupName = '';
try { const r = new URLSearchParams(location.search).get('ref'); if (r) localStorage.setItem('np_ref', r.slice(0, 16)); } catch (e) { /* storage blocked */ }

async function loadCatalog() { if (!catalog) catalog = await call('getCatalog'); return catalog; }
const balanceOf = a => (a === 'NGN' ? Number(data?.balanceNGN || 0) : Number(data?.assets?.[a] || 0));

// ------------------------------------------------------------------ navigation
function page(p) {
  document.querySelectorAll('.page').forEach(x => x.classList.toggle('active', x.id === p));
  if (p !== 'trade') stopFeed();
  if (p === 'trade') startTrade();
  if (p === 'giftcards') gifts();
  if (p === 'market') market();
  if (p === 'historyPage') history();
  if (p === 'deposit') loadDepositAddress();
  if (p === 'withdraw') fillNetworks();
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ auth
document.querySelectorAll('[data-tab]').forEach(b => (b.onclick = () => {
  document.querySelectorAll('[data-tab]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $('login').classList.toggle('hidden', b.dataset.tab !== 'login');
  $('signup').classList.toggle('hidden', b.dataset.tab !== 'signup');
}));

$('login').onsubmit = async e => {
  e.preventDefault();
  try { await signInWithEmailAndPassword(auth, $('le').value, $('lp').value); } catch (x) { msg($('authmsg'), err(x), 'error'); }
};
$('signup').onsubmit = async e => {
  e.preventDefault();
  try {
    signupName = $('sn').value.trim();
    const c = await createUserWithEmailAndPassword(auth, $('se').value, $('sp').value);
    await updateProfile(c.user, { displayName: signupName });
  } catch (x) { msg($('authmsg'), err(x), 'error'); }
};
async function googleLogin() { try { await signInWithPopup(auth, google); } catch (x) { msg($('authmsg'), err(x), 'error'); } }
$('google').onclick = googleLogin; $('googles').onclick = googleLogin;
$('forgot').onclick = async () => {
  if (!$('le').value) return msg($('authmsg'), 'Enter your email first', 'error');
  try { await sendPasswordResetEmail(auth, $('le').value); msg($('authmsg'), 'Password reset email sent', 'success'); } catch (x) { msg($('authmsg'), err(x), 'error'); }
};

onAuthStateChanged(auth, async u => {
  me = u;
  if (unsub) { unsub(); unsub = null; }
  if (!u) {
    data = null; stopFeed();
    $('auth').classList.remove('hidden'); $('app').classList.add('hidden');
    return;
  }
  try {
    // The profile (with a zero balance) is created by the server, never by the browser.
    await call('ensureProfile', { displayName: signupName || u.displayName || '', ref: localStorage.getItem('np_ref') || '' });
  } catch (x) { toast(err(x)); }
  $('auth').classList.add('hidden'); $('app').classList.remove('hidden');
  page('home');
  unsub = onSnapshot(doc(db, 'users', u.uid), s => { if (s.exists()) { data = s.data(); render(); } }, x => toast(err(x)));
});

function render() {
  const n = data.displayName || 'User';
  $('name').textContent = n; $('pname').textContent = n; $('pemail').textContent = me.email || '';
  if (document.activeElement !== $('pn')) $('pn').value = n;
  if (document.activeElement !== $('pc')) $('pc').value = data.country || '';
  $('avatar').textContent = n[0]?.toUpperCase() || 'N'; $('pavatar').textContent = n[0]?.toUpperCase() || 'N';
  $('bal').textContent = money(data.balanceNGN);
  $('bonus').textContent = `$${Number(data.bonusLockedUSD || 0).toFixed(2)} / $5.00`;
  $('rb').textContent = `$${Number(data.bonusLockedUSD || 0).toFixed(2)}`;
  $('statusText').textContent = data.status || 'active';
  const w = $('warning');
  w.classList.toggle('hidden', !data.warning && data.status !== 'banned');
  w.textContent = data.status === 'banned' ? '⚠️ Your account is banned. Transactions are disabled.' : '⚠️ ' + (data.warning || '');
  const a = data.assets || {};
  $('assets').innerHTML = ['USDT', 'BTC', 'ETH', 'BNB'].map(x => `<div class="asset row"><span><b>${x}</b><small> Crypto balance</small></span><b>${Number(a[x] || 0).toFixed(8)} ${x}</b></div>`).join('');
  $('ref').textContent = location.origin + location.pathname + '?ref=' + (data.refCode || me.uid.slice(0, 8));
  updateWithdrawBalance();
}

// ------------------------------------------------------------------ modal helpers
function modal(html) {
  $('modal').innerHTML = `<div class="backdrop"><div class="modal">${html}</div></div>`;
}
const closeModal = () => { $('modal').innerHTML = ''; };
let pendingAction = null; // set by confirmation modals

// Every button/link click goes through one delegated handler (no listeners pile up when modals reopen).
document.addEventListener('click', async e => {
  const nav = e.target.closest('[data-page]');
  if (nav) return page(nav.dataset.page);
  if (e.target.closest('.close')) return closeModal();

  const gift = e.target.closest('[data-gift]');
  if (gift) return giftModal(Number(gift.dataset.gift));
  const prod = e.target.closest('[data-prod]');
  if (prod) return productModal(Number(prod.dataset.prod));

  const id = e.target.closest('button')?.id;
  if (id === 'ps' || id === 'fl') return startPayment(id === 'ps' ? 'paystack' : 'flutterwave');
  if (id === 'savepass') return savePasscode();
  if (id === 'send') return sendChat();
  if (id === 'confirmBtn' && pendingAction) {
    const btn = e.target.closest('button'); btn.disabled = true;
    try { await pendingAction(); } catch (x) { msg($('cm'), err(x), 'error'); btn.disabled = false; }
  }
});
document.addEventListener('input', e => { if (e.target.id === 'sh_qty' || e.target.id === 'gq') refreshOrderTotal(); if (e.target.id === 'tradeamt') tradeEstimate(); });
document.addEventListener('change', e => { if (e.target.id === 'gd') refreshOrderTotal(); });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'cq') sendChat(); });

// ------------------------------------------------------------------ funding
$('fund').onclick = $('fund2').onclick = () => modal(`
  <div class="modalhead"><h2>Add money</h2><button class="close">×</button></div>
  <label>Amount (NGN)</label><input id="fa" type="number" inputmode="decimal" min="100" placeholder="1000">
  <div id="fm" class="status"></div>
  <button id="ps" class="primary full">Pay with Paystack</button>
  <button id="fl" class="secondary full">Pay with Flutterwave</button>
  <small>Your balance is credited only after the payment is confirmed by the provider.</small>`);

async function startPayment(provider) {
  const amount = Number($('fa').value);
  if (!(amount >= 100)) return msg($('fm'), 'Minimum ₦100', 'error');
  const done = () => msg($('fm'), 'Payment received. Your balance updates as soon as it is confirmed.', 'success');
  try {
    if (provider === 'paystack') {
      const r = await call('initializePaystackPayment', { amount });
      new PaystackPop().resumeTransaction(r.access_code, {
        onSuccess: async () => {
          try { await call('verifyPaystackPayment', { reference: r.reference }); msg($('fm'), 'Payment verified', 'success'); } catch (x) { done(); }
        },
        onCancel: () => msg($('fm'), 'Payment cancelled', 'error')
      });
    } else {
      if (FLW_PUBLIC_KEY.includes('REPLACE')) throw Error('Flutterwave public key is not set in app.js');
      const r = await call('initializeFlutterwavePayment', { amount });
      FlutterwaveCheckout({
        public_key: FLW_PUBLIC_KEY, tx_ref: r.tx_ref, amount: r.amount, currency: 'NGN', customer: { email: r.email },
        callback: async x => {
          try { await call('verifyFlutterwavePayment', { transactionId: x.transaction_id, tx_ref: r.tx_ref }); msg($('fm'), 'Payment verified', 'success'); } catch (y) { done(); }
        },
        onclose: () => { /* webhook still credits completed payments */ }
      });
    }
  } catch (x) { msg($('fm'), err(x), 'error'); }
}

// ------------------------------------------------------------------ store: gift cards + marketplace
async function gifts() {
  try {
    const c = await loadCatalog();
    const q = ($('giftsearch').value || '').toLowerCase(), r = $('giftregion').value;
    const list = c.giftCards.filter(x => (!q || x.brand.toLowerCase().includes(q)) && (!r || x.region === r));
    $('gifts').innerHTML = list.map(x => `<article class="card"><div class="art">🎁</div><h4>${esc(x.brand)} Gift Card</h4><small>${esc(x.region)}</small><div class="price">$${c.denoms[0]}–$${c.denoms.at(-1)}</div><button class="primary full" data-gift="${x.id}">Buy</button></article>`).join('') || '<p style="padding:0 20px">No matches.</p>';
  } catch (x) { $('gifts').innerHTML = `<p class="panel">${esc(err(x))}</p>`; }
}
$('giftsearch').oninput = gifts; $('giftregion').onchange = gifts;

async function market() {
  try {
    const c = await loadCatalog();
    $('products').innerHTML = c.products.map(p => `<article class="card"><div class="art">${p.emoji}</div><h4>${esc(p.name)}</h4><div class="price">$${p.priceUSD}</div><button class="primary full" data-prod="${p.id}">Order</button></article>`).join('');
  } catch (x) { $('products').innerHTML = `<p class="panel">${esc(err(x))}</p>`; }
}

let orderCtx = null; // { unitUSD, get qty()/den }
function refreshOrderTotal() {
  if (!orderCtx || !catalog) return;
  const qty = Math.max(1, Math.floor(Number($(orderCtx.kind === 'gift' ? 'gq' : 'sh_qty').value) || 1));
  const unit = orderCtx.kind === 'gift' ? Number($('gd').value) * (1 + catalog.giftMarkupPct / 100) : orderCtx.unitUSD;
  const totalNGN = unit * qty * catalog.usdNgn;
  $('ordertotal').textContent = `Total: ${money(totalNGN)} (wallet balance ${money(data?.balanceNGN)})`;
}

function giftModal(id) {
  const g = catalog.giftCards.find(x => x.id === id);
  orderCtx = { kind: 'gift' };
  modal(`<div class="modalhead"><h2>${esc(g.brand)} (${esc(g.region)})</h2><button class="close">×</button></div>
    <label>Denomination (USD)</label><select id="gd">${catalog.denoms.map(d => `<option>${d}</option>`).join('')}</select>
    <label>Quantity</label><input id="gq" type="number" min="1" max="10" value="1">
    <div id="ordertotal" class="quote"></div><div id="cm" class="status"></div>
    <button id="confirmBtn" class="primary full">Pay from wallet</button>
    <small>Codes are delivered after fulfilment; you will get a notification. Refunded automatically to your wallet if we cannot fulfil.</small>`);
  refreshOrderTotal();
  pendingAction = async () => {
    const r = await call('createOrder', { type: 'gift_card', productId: id, denomination: Number($('gd').value), quantity: Number($('gq').value) });
    closeModal(); toast('Order placed — ' + money(r.totalNGN) + ' paid');
  };
}

function productModal(id) {
  const p = catalog.products.find(x => x.id === id);
  orderCtx = { kind: 'product', unitUSD: p.priceUSD };
  modal(`<div class="modalhead"><h2>${esc(p.name)}</h2><button class="close">×</button></div>
    <label>Quantity</label><input id="sh_qty" type="number" min="1" max="5" value="1">
    <label>Delivery name</label><input id="sh_name" maxlength="80">
    <label>Phone</label><input id="sh_phone" type="tel" maxlength="30">
    <label>Delivery address</label><input id="sh_addr" maxlength="300">
    <div id="ordertotal" class="quote"></div><div id="cm" class="status"></div>
    <button id="confirmBtn" class="primary full">Pay from wallet</button>`);
  refreshOrderTotal();
  pendingAction = async () => {
    const r = await call('createOrder', {
      type: 'marketplace', productId: id, quantity: Number($('sh_qty').value),
      shipping: { name: $('sh_name').value, phone: $('sh_phone').value, address: $('sh_addr').value }
    });
    closeModal(); toast('Order placed — ' + money(r.totalNGN) + ' paid');
  };
}

// ------------------------------------------------------------------ trading (real Binance prices, market orders against the wallet)
let ws = null, series = [], feedId = 0, side = 'buy', lastPrice = 0;
function stopFeed() { feedId++; if (ws) { ws.onclose = null; ws.close(); ws = null; } }

async function startTrade() {
  stopFeed();
  const myId = feedId;
  const sym = $('pair').value + 'USDT', iv = $('interval').value;
  $('price').textContent = '…'; $('trademsg').className = 'status';
  loadCatalog().catch(() => {});
  loadOrders();
  try {
    const r = await fetch(`${BINANCE_REST}/klines?symbol=${sym}&interval=${iv}&limit=100`);
    if (!r.ok) throw new Error('feed');
    series = (await r.json()).map(k => Number(k[4]));
  } catch (x) { return msg($('trademsg'), 'Live price feed is unavailable right now', 'error'); }
  if (myId !== feedId) return;
  draw();
  const socket = new WebSocket(`${BINANCE_WS}/${sym.toLowerCase()}@kline_${iv}`);
  ws = socket;
  socket.onmessage = e => {
    if (ws !== socket) return;
    const k = JSON.parse(e.data).k, c = Number(k.c);
    series[series.length - 1] = c;
    if (k.x) { series.push(c); series = series.slice(-100); }
    draw();
  };
  socket.onclose = () => { if (ws === socket) { ws = null; setTimeout(() => { if ($('trade').classList.contains('active')) startTrade(); }, 3000); } };
}

function draw() {
  const c = $('chart');
  if (!c.clientWidth || !series.length) return;
  const ctx = c.getContext('2d'), dpr = devicePixelRatio || 1, w = c.clientWidth * dpr, h = 270 * dpr;
  c.width = w; c.height = h; ctx.clearRect(0, 0, w, h);
  const mi = Math.min(...series), ma = Math.max(...series);
  ctx.beginPath();
  series.forEach((v, i) => { const x = i * w / (series.length - 1 || 1), y = h - 20 - (v - mi) / (ma - mi || 1) * (h - 40); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = '#6835ed'; ctx.lineWidth = 2 * dpr; ctx.stroke();
  lastPrice = series.at(-1);
  $('price').textContent = '$' + lastPrice.toLocaleString(undefined, { maximumFractionDigits: 2 });
  tradeEstimate();
}
$('pair').onchange = startTrade; $('interval').onchange = startTrade;

function setSide(s) {
  side = s;
  $('buy').classList.toggle('active', s === 'buy'); $('sell').classList.toggle('active', s === 'sell');
  $('tradelabel').textContent = s === 'buy' ? 'USDT to spend' : `${$('pair').value} to sell`;
  tradeEstimate();
}
$('buy').onclick = () => setSide('buy'); $('sell').onclick = () => setSide('sell');
$('pair').addEventListener('change', () => setSide(side));

function estimate() {
  const amt = Number($('tradeamt').value);
  if (!(amt > 0) || !lastPrice || !catalog) return 0;
  const k = 1 - catalog.swapFeePct / 100;
  return side === 'buy' ? amt * k / lastPrice : amt * lastPrice * k;
}
function tradeEstimate() {
  const est = estimate(), sym = $('pair').value;
  const have = side === 'buy' ? balanceOf('USDT') : balanceOf(sym);
  $('tradeinfo').textContent = `Available: ${have.toFixed(side === 'buy' ? 2 : 8)} ${side === 'buy' ? 'USDT' : sym}` + (est ? ` • You get ≈ ${est.toFixed(side === 'buy' ? 8 : 2)} ${side === 'buy' ? sym : 'USDT'}` : '');
}

$('tradebtn').onclick = async () => {
  try {
    const r = await call('placeTrade', { symbol: $('pair').value, side, amount: Number($('tradeamt').value), quotedReceive: estimate() });
    msg($('trademsg'), `Filled. You received ${r.receive} ${side === 'buy' ? $('pair').value : 'USDT'}`, 'success');
    $('tradeamt').value = ''; loadOrders();
  } catch (x) { msg($('trademsg'), err(x), 'error'); }
};

async function loadOrders() {
  try {
    const s = await getDocs(query(collection(db, 'transactions'), where('uid', '==', me.uid), orderBy('createdAt', 'desc'), limit(100)));
    const rows = s.docs.map(d => d.data()).filter(x => String(x.type).startsWith('trade_')).slice(0, 10);
    $('orders').innerHTML = rows.map(x => `<div class="row"><span><b>${esc(x.type.replace('trade_', '').toUpperCase())}</b><small> ${esc(x.status)}</small></span><b>${esc(x.amountDisplay)}</b></div>`).join('') || '<p>No orders yet.</p>';
  } catch (x) { $('orders').textContent = err(x); }
}

// ------------------------------------------------------------------ swap
let lastQuote = null;
$('quoteBtn').onclick = async () => {
  try {
    const from = $('from').value, to = $('to').value, amount = Number($('swapamt').value);
    const r = await call('quoteSwap', { from, to, amount });
    lastQuote = { from, to, amount, receive: r.receive };
    $('quote').textContent = `${amount} ${from} → ${r.receive} ${to} (fee ${r.feePct}%)`;
  } catch (x) { lastQuote = null; msg($('swapmsg'), err(x), 'error'); }
};
$('swapBtn').onclick = async () => {
  const from = $('from').value, to = $('to').value, amount = Number($('swapamt').value);
  if (!lastQuote || lastQuote.from !== from || lastQuote.to !== to || lastQuote.amount !== amount) return msg($('swapmsg'), 'Tap “Get quote” first', 'error');
  try {
    const r = await call('executeSwap', { from, to, amount, quotedReceive: lastQuote.receive });
    msg($('swapmsg'), `Done: received ${r.receive} ${to}`, 'success'); lastQuote = null;
  } catch (x) { msg($('swapmsg'), err(x), 'error'); }
};

// ------------------------------------------------------------------ withdrawals
const WD_NETS = { NGN: ['Bank transfer'], USDT: ['ERC20', 'BEP20', 'Polygon', 'TRC20'], BTC: ['Bitcoin'], ETH: ['Ethereum'], BNB: ['BNB Smart Chain'] };
function fillNetworks() {
  const a = $('wa').value;
  $('wn').innerHTML = WD_NETS[a].map(n => `<option>${n}</option>`).join('');
  $('wdlabel').textContent = a === 'NGN' ? 'Bank name, account number, account name' : 'Wallet address';
  updateWithdrawBalance();
}
function updateWithdrawBalance() { if (data) $('wbal').textContent = `(available ${balanceOf($('wa').value)} ${$('wa').value})`; }
$('wa').onchange = fillNetworks;

$('withdrawBtn').onclick = async () => {
  try {
    const r = await call('requestWithdrawal', { asset: $('wa').value, network: $('wn').value, amount: Number($('wam').value), destination: $('wd').value, passcode: $('wp').value });
    $('wp').value = '';
    msg($('wmsg'), 'Withdrawal submitted for review (ref ' + r.withdrawalId + '). The amount is on hold until it is processed.', 'success');
  } catch (x) { msg($('wmsg'), err(x), 'error'); }
};

// ------------------------------------------------------------------ blockchain deposits
async function loadDepositAddress() {
  try { $('depaddr').textContent = (await call('getDepositAddress')).address; } catch (x) { $('depaddr').textContent = err(x); }
}
$('copyaddr').onclick = () => { navigator.clipboard.writeText($('depaddr').textContent); toast('Address copied'); };
$('verify').onclick = async () => {
  try {
    const r = await call('verifyBlockchainDeposit', { network: $('network').value, address: $('pub').value, txHash: $('tx').value });
    msg($('dmsg'), `Received ${r.amount} ${r.asset} (${r.confirmations} confirmations). It will be credited after review.`, 'success');
  } catch (x) { msg($('dmsg'), err(x), 'error'); }
};

// ------------------------------------------------------------------ profile / security
$('save').onclick = async () => {
  try {
    const name = $('pn').value.trim();
    if (!name) throw Error('Name is required');
    await updateDoc(doc(db, 'users', me.uid), { displayName: name, country: $('pc').value.trim(), updatedAt: serverTimestamp() });
    await updateProfile(me, { displayName: name });
    toast('Profile saved');
  } catch (x) { toast(err(x)); }
};
$('logout').onclick = () => signOut(auth);
$('pass').onclick = () => modal(`<div class="modalhead"><h2>Transaction passcode</h2><button class="close">×</button></div>
  ${data?.hasPasscode ? '<label>Current passcode</label><input id="oldpass" type="password" inputmode="numeric" maxlength="8">' : ''}
  <label>New passcode (4–8 digits)</label><input id="newpass" type="password" inputmode="numeric" maxlength="8">
  <button id="savepass" class="primary full">Save</button><div id="passmsg" class="status"></div>`);
async function savePasscode() {
  try {
    await call('setTransactionPasscode', { passcode: $('newpass').value, currentPasscode: $('oldpass')?.value || '' });
    msg($('passmsg'), 'Passcode saved', 'success');
  } catch (x) { msg($('passmsg'), err(x), 'error'); }
}
$('face').onclick = () => toast('Identity verification is not available yet.');
$('copy').onclick = () => { navigator.clipboard.writeText($('ref').textContent); toast('Invitation link copied'); };

// ------------------------------------------------------------------ history + notifications
$('history').onclick = () => page('historyPage');
async function history() {
  try {
    const s = await getDocs(query(collection(db, 'transactions'), where('uid', '==', me.uid), orderBy('createdAt', 'desc'), limit(100)));
    $('historyList').innerHTML = s.docs.map(d => {
      const x = d.data();
      return `<div class="row"><span><b>${esc(String(x.type).replace(/_/g, ' '))}</b><small> ${esc(x.status || '')} ${esc(x.createdAt?.toDate?.().toLocaleString() || '')}</small></span><b>${esc(x.amountDisplay || '')}</b></div>`;
    }).join('') || '<p>No transactions yet.</p>';
  } catch (x) { $('historyList').textContent = err(x); }
}
$('bell').onclick = async () => {
  modal(`<div class="modalhead"><h2>Notifications</h2><button class="close">×</button></div><div id="notes">Loading…</div>`);
  try {
    const s = await getDocs(query(collection(db, 'notifications'), where('uid', '==', me.uid), orderBy('createdAt', 'desc'), limit(30)));
    $('notes').innerHTML = s.docs.map(d => `<div class="row"><span>${esc(d.data().message)}</span><small>${esc(d.data().createdAt?.toDate?.().toLocaleDateString() || '')}</small></div>`).join('') || '<p>Nothing yet.</p>';
  } catch (x) { $('notes').textContent = err(x); }
};

// ------------------------------------------------------------------ customer care
$('care').onclick = () => {
  const links = [['Telegram', SUPPORT.telegram], ['Twitter / X', SUPPORT.x], ['TikTok', SUPPORT.tiktok]]
    .filter(l => /^https:\/\//.test(l[1])).map(l => `<a class="secondary full" href="${esc(l[1])}" target="_blank" rel="noopener">${l[0]}</a>`).join('');
  modal(`<div class="modalhead"><h2>NovaPay Customer Care</h2><button class="close">×</button></div>
    <div class="chat"><div id="messages" class="messages"><div class="bubble bot">Hi! Ask about funding, withdrawals, trading, gift cards or security.</div></div>
    <div class="chatinput"><input id="cq" placeholder="Type a question"><button id="send" class="primary">Send</button></div></div>${links}`);
};
function addBubble(cls, text) { const d = document.createElement('div'); d.className = 'bubble ' + cls; d.textContent = text; $('messages').appendChild(d); $('messages').scrollTop = $('messages').scrollHeight; }
function sendChat() {
  const q = $('cq')?.value.trim(); if (!q) return;
  addBubble('me', q); $('cq').value = '';
  setTimeout(() => addBubble('bot', care(q)), 250);
}
function care(q) {
  q = q.toLowerCase();
  if (q.includes('withdraw')) return 'Withdrawals need your transaction passcode, are at least $10 equivalent, and are reviewed before payout. Funds are held while pending.';
  if (q.includes('gift')) return 'Open Gift Cards, pick a brand, denomination and quantity, and pay from your NGN wallet. Codes are delivered after fulfilment.';
  if (q.includes('trade') || q.includes('swap')) return 'Trading and swaps are instant market orders at the live price plus a small fee, using your wallet balances.';
  if (q.includes('deposit') || q.includes('fund')) return 'Use Paystack, Flutterwave or Blockchain Deposit. Balances are credited only after the payment is confirmed.';
  if (q.includes('password')) return 'Use “Forgot password?” on the login page.';
  return 'For account-specific help, contact us through the support links below. Never share your password, seed phrase or private key.';
}
