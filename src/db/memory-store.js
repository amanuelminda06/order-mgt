/**
 * In-memory data store (legacy behaviour).
 *
 * EVERYTHING here is lost on cold start. This module exists only so the
 * route modules share one set of references during the transition; it is
 * replaced by Supabase in a later migration step.
 *
 * Do not add new features on top of this file.
 */
const bcrypt = require('bcryptjs');

// ── Counters ──────────────────────────────────────────────
// Exported as an object so every module mutates the SAME values.
const counters = {
  orderId: 1000, // generateOrderNumber() increments then uses
  categoryId: 3, // reseeded to 7 below, mirrors server.js:60,70
  amendmentId: 0,
};

// ── Tables ────────────────────────────────────────────────
const tables = [];
for (let i = 1; i <= 10; i++) {
  const names = { 1: 'Patio 1', 2: 'Patio 2', 3: 'Patio 3', 4: 'Hall 1', 5: 'Hall 2', 6: 'Hall 3', 7: 'VIP 1', 8: 'VIP 2', 9: 'Bar 1', 10: 'Bar 2' };
  const caps = { 3: 2, 6: 8, 9: 2, 10: 2 };
  tables.push({ id: i, table_number: i, name: names[i] || `Table ${i}`, capacity: caps[i] || 4 });
}

// ── Menu ──────────────────────────────────────────────────
const menuItems = [
  { id:1, name:'Grilled Salmon', description:'Fresh Atlantic salmon with lemon herb butter, seasonal vegetables', price:28.00, category:'food', subcategory:'Mains', available:true, image:'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=400&q=80' },
  { id:2, name:'Wagyu Beef Burger', description:'Premium Wagyu patty, truffle aioli, caramelized onions, aged cheddar', price:24.00, category:'food', subcategory:'Mains', available:true, image:'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&q=80' },
  { id:3, name:'Chicken Caesar Salad', description:'Romaine hearts, parmesan crisps, croutons, house-made dressing', price:16.00, category:'food', subcategory:'Starters', available:true, image:'https://images.unsplash.com/photo-1550304943-4f24f54ddde9?w=400&q=80' },
  { id:4, name:'Bruschetta Trio', description:'Tomato basil, mushroom truffle, roasted pepper on artisan bread', price:14.00, category:'food', subcategory:'Starters', available:true, image:'https://images.unsplash.com/photo-1572695157366-5e585ab2b69f?w=400&q=80' },
  { id:5, name:'Lobster Mac & Cheese', description:'Maine lobster, three cheese blend, truffle breadcrumbs', price:32.00, category:'food', subcategory:'Mains', available:true, image:'https://images.unsplash.com/photo-1543339494-b4cd4f7ba686?w=400&q=80' },
  { id:6, name:'Margherita Pizza', description:'Wood-fired, San Marzano tomatoes, fresh mozzarella, basil', price:18.00, category:'food', subcategory:'Mains', available:true, image:'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400&q=80' },
  { id:7, name:'Truffle Fries', description:'Crispy hand-cut fries with truffle oil and parmesan', price:10.00, category:'food', subcategory:'Sides', available:true, image:'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=400&q=80' },
  { id:8, name:'Caesar Wings', description:'Crispy wings tossed in Caesar dressing with blue cheese dip', price:14.00, category:'food', subcategory:'Starters', available:true, image:'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=400&q=80' },
  { id:9, name:'Sunset Spritz', description:'Aperol, prosecco, fresh orange, splash of soda', price:16.00, category:'bar', subcategory:'Cocktails', available:true, image:'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?w=400&q=80' },
  { id:10, name:'Classic Old Fashioned', description:'Bourbon, Angostura bitters, sugar cube, orange peel', price:18.00, category:'bar', subcategory:'Cocktails', available:true, image:'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=400&q=80' },
  { id:11, name:'Mojito', description:'White rum, fresh lime, mint, soda water', price:15.00, category:'bar', subcategory:'Cocktails', available:true, image:'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?w=400&q=80' },
  { id:12, name:'Espresso Martini', description:'Vodka, Kahlua, fresh espresso, vanilla syrup', price:17.00, category:'bar', subcategory:'Cocktails', available:true, image:'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=400&q=80' },
  { id:13, name:'Mango Tango', description:'Vodka, mango puree, lime, chili salt rim', price:16.00, category:'bar', subcategory:'Cocktails', available:true, image:'https://images.unsplash.com/photo-1536935338788-846bb9981813?w=400&q=80' },
  { id:14, name:'Whiskey Sour', description:'Bourbon, lemon juice, simple syrup, egg white', price:16.00, category:'bar', subcategory:'Cocktails', available:true, image:'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=400&q=80' },
  { id:15, name:'Craft IPA', description:'Local brewery rotating selection', price:9.00, category:'bar', subcategory:'Beer', available:true, image:'https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=400&q=80' },
  { id:16, name:'Belgian Wheat', description:'Refreshing wheat beer with citrus notes', price:8.00, category:'bar', subcategory:'Beer', available:true, image:'https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=400&q=80' },
  { id:17, name:'House Red Wine', description:'Cabernet Sauvignon, full-bodied with dark fruit', price:12.00, category:'bar', subcategory:'Wine', available:true, image:'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=400&q=80' },
  { id:18, name:'House White Wine', description:'Sauvignon Blanc, crisp and refreshing', price:11.00, category:'bar', subcategory:'Wine', available:true, image:'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=400&q=80' },
  { id:19, name:'Sparkling Water', description:'San Pellegrino 750ml', price:6.00, category:'bar', subcategory:'Non-Alcoholic', available:true, image:'https://images.unsplash.com/photo-1523362628745-0c100fc988a6?w=400&q=80' },
  { id:20, name:'Fresh Juice', description:'Orange, apple, or watermelon', price:7.00, category:'bar', subcategory:'Non-Alcoholic', available:true, image:'https://images.unsplash.com/photo-1622597467836-f3285f2131b8?w=400&q=80' },
];

// ── Staff ─────────────────────────────────────────────────
const staff = [
  { id:1, username:'admin', password:bcrypt.hashSync('admin',10), full_name:'Admin Manager', role:'admin', active:true },
  { id:2, username:'waiter', password:bcrypt.hashSync('admin',10), full_name:'John Waiter', role:'waiter', active:true },
  { id:3, username:'bartender', password:bcrypt.hashSync('admin',10), full_name:'Jane Bartender', role:'bartender', active:true },
];

// ── Categories ────────────────────────────────────────────
const categories = [
  { id: 1, name: 'Starters', section: 'food' },
  { id: 2, name: 'Mains', section: 'food' },
  { id: 3, name: 'Sides', section: 'food' },
  { id: 4, name: 'Cocktails', section: 'bar' },
  { id: 5, name: 'Beer', section: 'bar' },
  { id: 6, name: 'Wine', section: 'bar' },
  { id: 7, name: 'Non-Alcoholic', section: 'bar' },
];
counters.categoryId = 7;

// ── Orders & amendments ───────────────────────────────────
const orders = [];
const amendments = [];

// ── Settings ──────────────────────────────────────────────
const settings = {
  restaurant_name: 'Sunset Bistro & Lounge',
  tagline: 'Where Every Meal is a Sunset Moment',
  phone: '+1 (555) 987-6543',
  address: '456 Ocean Drive, Miami Beach, FL 33139',
  email: 'info@sunsetbistro.com',
};

// ── Helpers bound to this store ───────────────────────────
function generateOrderNumber() {
  counters.orderId++;
  return `ORD-${counters.orderId}`;
}

module.exports = {
  counters,
  tables,
  menuItems,
  staff,
  categories,
  orders,
  amendments,
  settings,
  generateOrderNumber,
};
