// Single source of truth for what can be bought. Prices are NEVER taken from the browser.
const BRANDS = [
  'Amazon', 'Apple', 'Google Play', 'Steam', 'PlayStation', 'Xbox', 'Nintendo eShop', 'Netflix', 'Spotify', 'Uber',
  'Uber Eats', 'Nike', 'Adidas', 'Walmart', 'Target', 'eBay', 'Best Buy', 'Sephora', 'IKEA', 'Airbnb',
  'Hotels.com', 'Zalando', 'ASOS', 'H&M', 'Zara', 'Foot Locker', 'GameStop', 'Razer Gold', 'Roblox', 'Disney+',
  'Hulu', 'DoorDash', 'Starbucks', 'Home Depot', "Lowe's", "Macy's", 'Nordstrom', 'Booking.com'
]; // 38 brands x 4 regions = 152; the first 150 are used
const REGIONS = ['US', 'UK', 'NG', 'EU'];
const DENOMS = [10, 25, 50, 100, 200];

const GIFT_CARDS = [];
for (const brand of BRANDS) {
  for (const region of REGIONS) {
    if (GIFT_CARDS.length < 150) GIFT_CARDS.push({ id: GIFT_CARDS.length + 1, brand, region });
  }
}

const PRODUCTS = [
  { id: 1, name: 'Premium T-Shirt', emoji: '👕', priceUSD: 35 },
  { id: 2, name: 'Signature Hoodie', emoji: '🧥', priceUSD: 65 },
  { id: 3, name: 'Classic Dress', emoji: '👗', priceUSD: 80 },
  { id: 4, name: 'Street Sneakers', emoji: '👟', priceUSD: 95 },
  { id: 5, name: 'Gold Waist Watch', emoji: '⌚', priceUSD: 220 },
  { id: 6, name: 'Luxury Gold Wrist Watch', emoji: '⌚', priceUSD: 450 },
  { id: 7, name: 'Gold Chronograph', emoji: '⌚', priceUSD: 650 },
  { id: 8, name: 'Gold Bracelet', emoji: '✨', priceUSD: 180 },
  { id: 9, name: 'Gold Chain', emoji: '🔗', priceUSD: 320 },
  { id: 10, name: 'Leather Bag', emoji: '👜', priceUSD: 120 }
];

module.exports = {
  DENOMS,
  GIFT_CARDS,
  PRODUCTS,
  GIFT_BY_ID: Object.fromEntries(GIFT_CARDS.map(g => [g.id, g])),
  PRODUCT_BY_ID: Object.fromEntries(PRODUCTS.map(p => [p.id, p]))
};
