/**
 * In-memory data store (legacy behaviour).
 *
 * EVERYTHING here is lost on cold start. This module exists only so the
 * route modules share one set of references during the transition; it is
 * replaced by Supabase in a later migration step.
 *
 * Menu content below is the REAL Cupcake Delights menu (seeded to mirror
 * sql/004_menu.sql). The legacy code calls the drinks section `bar`
 * internally; the UI label is "Drinks". The value is renamed to `drink`
 * when the read paths move to Supabase.
 *
 * Do not add new features on top of this file.
 */
const bcrypt = require('bcryptjs');

// ── Counters ──────────────────────────────────────────────
// Exported as an object so every module mutates the SAME values.
const counters = {
  orderId: 1000, // generateOrderNumber() increments then uses
  categoryId: 3, // reseeded to 15 below
  amendmentId: 0,
};

// ── Tables ────────────────────────────────────────────────
const tables = [];
for (let i = 1; i <= 10; i++) {
  const names = { 1: 'Patio 1', 2: 'Patio 2', 3: 'Patio 3', 4: 'Hall 1', 5: 'Hall 2', 6: 'Hall 3', 7: 'VIP 1', 8: 'VIP 2', 9: 'Bar 1', 10: 'Bar 2' };
  const caps = { 3: 2, 6: 8, 9: 2, 10: 2 };
  tables.push({ id: i, table_number: i, name: names[i] || `Table ${i}`, capacity: caps[i] || 4 });
}

// ── Menu (real Cupcake Delights content) ──────────────────
// category: 'food' (Restaurant tab) | 'bar' (Drinks tab — legacy value)
// subcategory must match the category name exactly (drives the filter pills).
const menuItems = [
  // ── Breakfast ──
  { id:1, name:'French Toast', description:'Topped with peanut, strawberry & cinnamon butter.', price:500, category:'food', subcategory:'Breakfast', available:true, image:'' },
  { id:2, name:'Waffle/Pancake', description:'Topped with peanut, strawberry & cinnamon butter.', price:500, category:'food', subcategory:'Breakfast', available:true, image:'' },
  { id:3, name:'Mix & Match Egg', description:'Eggs any style, hash browns, sausage, garlic, and fruit.', price:500, category:'food', subcategory:'Breakfast', available:true, image:'' },
  { id:4, name:'Cinnamon Oatmeal', description:'Oatmeal combined with fresh strawberry, banana & cinnamon.', price:450, category:'food', subcategory:'Breakfast', available:true, image:'' },
  { id:5, name:'Ethio Spicy Foul', description:'Warm spicy stew of fava beans, onion, tomato, chili, egg and avocado.', price:450, category:'food', subcategory:'Breakfast', available:true, image:'' },
  { id:6, name:'Avocado Toast Sandwich', description:'Brown toast bread topped with sliced avocado and egg.', price:600, category:'food', subcategory:'Breakfast', available:true, image:'' },
  { id:7, name:'Croissant with Egg & Cheese', description:'Fluffy eggs, cheese, and crispy beef slice in a croissant breakfast sandwich.', price:600, category:'food', subcategory:'Breakfast', available:true, image:'' },
  { id:8, name:'Fasting Avocado Toast', description:'Brown toast bread topped with sliced avocado.', price:500, category:'food', subcategory:'Breakfast', available:true, image:'' },
  { id:9, name:'Chechebsa', description:'Torn pieces of homemade flatbread (kita) with honey.', price:500, category:'food', subcategory:'Breakfast', available:true, image:'' },
  { id:10, name:'Kinche', description:'Ethiopian kinche combined with fresh slices of avocado.', price:500, category:'food', subcategory:'Breakfast', available:true, image:'' },

  // ── Pasta ──
  { id:11, name:'Homemade Lasagna', description:'Layers of pasta filled with minced meat sauce, Béchamel, Parmesan and Mozzarella cheese.', price:950, category:'food', subcategory:'Pasta', available:true, image:'' },
  { id:12, name:'Spaghetti or Rigatoni - Tomato Basil/Veggie', description:'Served with tomato basil or veggie sauce.', price:660, category:'food', subcategory:'Pasta', available:true, image:'' },
  { id:13, name:'Spaghetti or Rigatoni - Bologna', description:'Served with rich bologna sauce.', price:749, category:'food', subcategory:'Pasta', available:true, image:'' },
  { id:14, name:'Spaghetti or Rigatoni - Chicken Alfredo', description:'Served with creamy chicken Alfredo sauce.', price:799, category:'food', subcategory:'Pasta', available:true, image:'' },
  { id:15, name:'Spaghetti or Rigatoni - Tuna', description:'Served with tuna sauce.', price:700, category:'food', subcategory:'Pasta', available:true, image:'' },

  // ── Salads ──
  { id:16, name:'Chicken Salad', description:'Fresh salad with chicken, lemon vinaigrette dressing and creamy Italian dressing.', price:590, category:'food', subcategory:'Salads', available:true, image:'' },
  { id:17, name:'Tuna Salad', description:'Fresh salad with tuna, lemon vinaigrette dressing and creamy Italian dressing.', price:550, category:'food', subcategory:'Salads', available:true, image:'' },
  { id:18, name:'Beef Salad', description:'Fresh salad with beef, lemon vinaigrette dressing and creamy Italian dressing.', price:590, category:'food', subcategory:'Salads', available:true, image:'' },
  { id:19, name:'Salad Bowl', description:'Freshly cut avocado, cucumbers, tomatoes, red onions, olive seed, nuts, cherry tomatoes and sweet corn.', price:450, category:'food', subcategory:'Salads', available:true, image:'' },

  // ── Pizza ──
  { id:20, name:'Pesto Margarita', description:'Marinara sauce, cherry tomato, cheese and oregano.', price:599, category:'food', subcategory:'Pizza', available:true, image:'' },
  { id:21, name:'Rocco Pesto Pizza', description:'Basil pesto, sun-dried tomatoes, black olives, mozzarella, tuna and red onion.', price:880, category:'food', subcategory:'Pizza', available:true, image:'' },
  { id:22, name:'Chicken Pizza', description:'Mozzarella cheese, chicken breast, mushroom, red onions and tomato.', price:930, category:'food', subcategory:'Pizza', available:true, image:'' },
  { id:23, name:'Ortolana Lover', description:'Marinara, mushroom, onions, green peppers, spinach, black olives, tomatoes and broccoli.', price:857, category:'food', subcategory:'Pizza', available:true, image:'' },
  { id:24, name:'Toto E’ Peppion Blanca', description:'Spiced tender strips of beef, onion, garlic, pepper, tomato and mozzarella.', price:880, category:'food', subcategory:'Pizza', available:true, image:'' },
  { id:25, name:'Delight Special Pizza', description:'Chicken breast, beef, sausage, cheese, mushroom, onion and black olives.', price:980, category:'food', subcategory:'Pizza', available:true, image:'' },

  // ── Main Dish ──
  { id:26, name:'Bourbon Steak', description:'Pesto mashed potato, button mushroom and brown sauce.', price:990, category:'food', subcategory:'Main Dish', available:true, image:'' },
  { id:27, name:'Chicken Breast', description:'Freshly made sauce with cheese on top, sweet corn, rice and spinach.', price:990, category:'food', subcategory:'Main Dish', available:true, image:'' },
  { id:28, name:'Chicken or Beef Fajita', description:'Juicy chicken or beef, pepper, onion, tomato and guacamole.', price:950, category:'food', subcategory:'Main Dish', available:true, image:'' },
  { id:29, name:'Combo Fajita', description:'Juicy chicken and beef, pepper, onion, tomato and guacamole.', price:990, category:'food', subcategory:'Main Dish', available:true, image:'' },

  // ── Burger & Sandwich ──
  { id:30, name:'Cheese Burger', description:'Grilled beef patties with tomatoes, lettuce, cheese, mayonnaise and sliced onions on a toasted sesame seed bun.', price:790, category:'food', subcategory:'Burger & Sandwich', available:true, image:'' },
  { id:31, name:'Grilled Chicken Panini', description:'Chicken breast, avocado and mayonnaise.', price:890, category:'food', subcategory:'Burger & Sandwich', available:true, image:'' },
  { id:32, name:'Veggie Sandwich', description:'Stacked grilled vegetables on spread guacamole.', price:690, category:'food', subcategory:'Burger & Sandwich', available:true, image:'' },
  { id:33, name:'Cheese and Steak Sandwich', description:'Tender steak, cheese, caramelized onion and toasted garlic butter bread.', price:850, category:'food', subcategory:'Burger & Sandwich', available:true, image:'' },
  { id:34, name:'Classic Club Sandwich', description:'Grilled chicken breast, egg, tomato, cheese, lettuce and mayonnaise.', price:890, category:'food', subcategory:'Burger & Sandwich', available:true, image:'' },
  { id:35, name:'Tuna Sandwich', description:'Tuna chunk sandwich, tomato, onion and sweet corn.', price:770, category:'food', subcategory:'Burger & Sandwich', available:true, image:'' },

  // ── Desserts ──
  { id:36, name:'Fasting Mille Feuille', description:'', price:350, category:'food', subcategory:'Desserts', available:true, image:'' },
  { id:37, name:'Fasting Brownie', description:'', price:250, category:'food', subcategory:'Desserts', available:true, image:'' },
  { id:38, name:'Fasting Triple Chocolate', description:'', price:350, category:'food', subcategory:'Desserts', available:true, image:'' },
  { id:39, name:'English Cake', description:'', price:275, category:'food', subcategory:'Desserts', available:true, image:'' },
  { id:40, name:'Fruit Tart', description:'', price:230, category:'food', subcategory:'Desserts', available:true, image:'' },
  { id:41, name:'Chocolate Mousse', description:'', price:300, category:'food', subcategory:'Desserts', available:true, image:'' },
  { id:42, name:'Triple Chocolate', description:'', price:350, category:'food', subcategory:'Desserts', available:true, image:'' },
  { id:43, name:'Tiramisu', description:'', price:350, category:'food', subcategory:'Desserts', available:true, image:'' },
  { id:44, name:'Red Velvet', description:'', price:350, category:'food', subcategory:'Desserts', available:true, image:'' },
  { id:45, name:'Choco Caramel', description:'', price:350, category:'food', subcategory:'Desserts', available:true, image:'' },
  { id:46, name:'Mille Feuille', description:'', price:350, category:'food', subcategory:'Desserts', available:true, image:'' },
  { id:47, name:'Crunch Honey', description:'', price:350, category:'food', subcategory:'Desserts', available:true, image:'' },
  { id:48, name:'Cream Puff', description:'', price:350, category:'food', subcategory:'Desserts', available:true, image:'' },
  { id:49, name:'Cheese Cake', description:'', price:500, category:'food', subcategory:'Desserts', available:true, image:'' },
  { id:50, name:'Pain au Chocolat', description:'', price:350, category:'food', subcategory:'Desserts', available:true, image:'' },
  { id:51, name:'Croissant', description:'', price:350, category:'food', subcategory:'Desserts', available:true, image:'' },
  { id:52, name:'Cinnamon Roll', description:'', price:400, category:'food', subcategory:'Desserts', available:true, image:'' },

  // ── Cupcakes ──
  { id:53, name:'Red Velvet', description:'', price:170, category:'food', subcategory:'Cupcakes', available:true, image:'' },
  { id:54, name:'Vanilla', description:'', price:170, category:'food', subcategory:'Cupcakes', available:true, image:'' },
  { id:55, name:'Double Choco', description:'', price:170, category:'food', subcategory:'Cupcakes', available:true, image:'' },
  { id:56, name:'Choco Vanilla', description:'', price:170, category:'food', subcategory:'Cupcakes', available:true, image:'' },
  { id:57, name:'Caramel', description:'', price:170, category:'food', subcategory:'Cupcakes', available:true, image:'' },
  { id:58, name:'Fasting Cupcake', description:'', price:170, category:'food', subcategory:'Cupcakes', available:true, image:'' },

  // ── Ice Cream ──
  { id:59, name:'Vanilla', description:'', price:200, category:'food', subcategory:'Ice Cream', available:true, image:'' },
  { id:60, name:'Strawberry', description:'', price:200, category:'food', subcategory:'Ice Cream', available:true, image:'' },
  { id:61, name:'Mocha', description:'', price:200, category:'food', subcategory:'Ice Cream', available:true, image:'' },
  { id:62, name:'Chocolate', description:'', price:200, category:'food', subcategory:'Ice Cream', available:true, image:'' },
  { id:63, name:'Rum Raisin', description:'', price:200, category:'food', subcategory:'Ice Cream', available:true, image:'' },
  { id:64, name:'Oreo Chocolate', description:'', price:200, category:'food', subcategory:'Ice Cream', available:true, image:'' },
  { id:65, name:'Caramel', description:'', price:200, category:'food', subcategory:'Ice Cream', available:true, image:'' },
  { id:66, name:'Coffee', description:'', price:200, category:'food', subcategory:'Ice Cream', available:true, image:'' },

  // ── Coffee ──
  { id:67, name:'Espresso', description:'', price:155, category:'bar', subcategory:'Coffee', available:true, image:'' },
  { id:68, name:'Tea with Coffee', description:'', price:155, category:'bar', subcategory:'Coffee', available:true, image:'' },
  { id:69, name:'Latte', description:'', price:275, category:'bar', subcategory:'Coffee', available:true, image:'' },
  { id:70, name:'Americano', description:'', price:180, category:'bar', subcategory:'Coffee', available:true, image:'' },
  { id:71, name:'Caramel Macchiato', description:'', price:250, category:'bar', subcategory:'Coffee', available:true, image:'' },
  { id:72, name:'Double Caramel Macchiato', description:'', price:385, category:'bar', subcategory:'Coffee', available:true, image:'' },
  { id:73, name:'Macchiato', description:'', price:180, category:'bar', subcategory:'Coffee', available:true, image:'' },
  { id:74, name:'Black Coffee', description:'', price:155, category:'bar', subcategory:'Coffee', available:true, image:'' },
  { id:75, name:'Cappuccino', description:'', price:345, category:'bar', subcategory:'Coffee', available:true, image:'' },
  { id:76, name:'Double Macchiato', description:'', price:360, category:'bar', subcategory:'Coffee', available:true, image:'' },
  { id:77, name:'Mocha', description:'', price:405, category:'bar', subcategory:'Coffee', available:true, image:'' },
  { id:78, name:'Fasting Macchiato', description:'', price:275, category:'bar', subcategory:'Coffee', available:true, image:'' },

  // ── Iced Coffee ──
  { id:79, name:'Vanilla Latte', description:'', price:385, category:'bar', subcategory:'Iced Coffee', available:true, image:'' },
  { id:80, name:'Spanish Latte', description:'', price:385, category:'bar', subcategory:'Iced Coffee', available:true, image:'' },
  { id:81, name:'Frappe', description:'', price:500, category:'bar', subcategory:'Iced Coffee', available:true, image:'' },
  { id:82, name:'Espresso on Ice', description:'', price:385, category:'bar', subcategory:'Iced Coffee', available:true, image:'' },
  { id:83, name:'Caramel Latte', description:'', price:385, category:'bar', subcategory:'Iced Coffee', available:true, image:'' },
  { id:84, name:'Ice Latte', description:'', price:350, category:'bar', subcategory:'Iced Coffee', available:true, image:'' },

  // ── Milk-Infused ──
  { id:85, name:'Milkshake', description:'', price:495, category:'bar', subcategory:'Milk-Infused', available:true, image:'' },
  { id:86, name:'Milk', description:'', price:220, category:'bar', subcategory:'Milk-Infused', available:true, image:'' },
  { id:87, name:'Hot Chocolate', description:'', price:345, category:'bar', subcategory:'Milk-Infused', available:true, image:'' },

  // ── Juices & Smoothies ──
  { id:88, name:'Watermelon', description:'', price:450, category:'bar', subcategory:'Juices & Smoothies', available:true, image:'' },
  { id:89, name:'Strawberry', description:'', price:499, category:'bar', subcategory:'Juices & Smoothies', available:true, image:'' },
  { id:90, name:'Papaya', description:'', price:450, category:'bar', subcategory:'Juices & Smoothies', available:true, image:'' },
  { id:91, name:'Mixed Juice', description:'', price:450, category:'bar', subcategory:'Juices & Smoothies', available:true, image:'' },
  { id:92, name:'Mango', description:'', price:450, category:'bar', subcategory:'Juices & Smoothies', available:true, image:'' },
  { id:93, name:'Cucumber with Ginger', description:'', price:450, category:'bar', subcategory:'Juices & Smoothies', available:true, image:'' },
  { id:94, name:'Avocado', description:'', price:450, category:'bar', subcategory:'Juices & Smoothies', available:true, image:'' },
  { id:95, name:'Papaya with Flexiseed', description:'', price:499, category:'bar', subcategory:'Juices & Smoothies', available:true, image:'' },
  { id:96, name:'Mango with Flexiseed', description:'', price:499, category:'bar', subcategory:'Juices & Smoothies', available:true, image:'' },
  { id:97, name:'Strawberry Smoothie', description:'', price:450, category:'bar', subcategory:'Juices & Smoothies', available:true, image:'' },
  { id:98, name:'Strawberry & Avocado Smoothie', description:'', price:550, category:'bar', subcategory:'Juices & Smoothies', available:true, image:'' },
  { id:99, name:'Papaya & Banana Smoothie', description:'', price:490, category:'bar', subcategory:'Juices & Smoothies', available:true, image:'' },
  { id:100, name:'Mixed Smoothie', description:'', price:500, category:'bar', subcategory:'Juices & Smoothies', available:true, image:'' },
  { id:101, name:'Avocado & Banana Smoothie', description:'', price:490, category:'bar', subcategory:'Juices & Smoothies', available:true, image:'' },

  // ── Tea ──
  { id:102, name:'Lemon Tea', description:'', price:165, category:'bar', subcategory:'Tea', available:true, image:'' },
  { id:103, name:'Ginger Tea', description:'', price:165, category:'bar', subcategory:'Tea', available:true, image:'' },
  { id:104, name:'Special Tea', description:'', price:299, category:'bar', subcategory:'Tea', available:true, image:'' },
  { id:105, name:'Green Tea', description:'', price:175, category:'bar', subcategory:'Tea', available:true, image:'' },
  { id:106, name:'Flavoured Tea', description:'', price:165, category:'bar', subcategory:'Tea', available:true, image:'' },
  { id:107, name:'Black Tea', description:'', price:125, category:'bar', subcategory:'Tea', available:true, image:'' },
  { id:108, name:'Tea Latte', description:'', price:220, category:'bar', subcategory:'Tea', available:true, image:'' },
  { id:109, name:'Ginger Latte', description:'', price:250, category:'bar', subcategory:'Tea', available:true, image:'' },

  // ── Soft Drinks ──
  { id:110, name:'Water', description:'', price:125, category:'bar', subcategory:'Soft Drinks', available:true, image:'' },
  { id:111, name:'Sprite', description:'', price:140, category:'bar', subcategory:'Soft Drinks', available:true, image:'' },
  { id:112, name:'Coca Cola', description:'', price:140, category:'bar', subcategory:'Soft Drinks', available:true, image:'' },
  { id:113, name:'Novida', description:'', price:140, category:'bar', subcategory:'Soft Drinks', available:true, image:'' },
  { id:114, name:'Ambo Water', description:'', price:140, category:'bar', subcategory:'Soft Drinks', available:true, image:'' },
];

// ── Staff ─────────────────────────────────────────────────
// Mirrors sql/002_seed.sql exactly (same usernames + passwords), so a
// login works the same before and after the read paths move to Supabase.
const staff = [
  { id:1, username:'admin',    password:bcrypt.hashSync('Admin123',10),   full_name:'Administrator', role:'admin',   active:true },
  { id:2, username:'waiter1',  password:bcrypt.hashSync('Waiter123',10),  full_name:'Waiter One',    role:'waiter',  active:true },
  { id:3, username:'kitchen1', password:bcrypt.hashSync('Kitchen123',10), full_name:'Kitchen One',   role:'kitchen', active:true },
  { id:4, username:'cashier1', password:bcrypt.hashSync('Cashier123',10), full_name:'Cashier One',   role:'cashier', active:true },
];

// ── Categories ────────────────────────────────────────────
// 9 food + 6 drinks = 15. `section` uses the legacy value 'bar' for drinks.
const categories = [
  { id: 1,  name: 'Breakfast',          section: 'food' },
  { id: 2,  name: 'Pasta',              section: 'food' },
  { id: 3,  name: 'Salads',             section: 'food' },
  { id: 4,  name: 'Pizza',              section: 'food' },
  { id: 5,  name: 'Main Dish',          section: 'food' },
  { id: 6,  name: 'Burger & Sandwich',  section: 'food' },
  { id: 7,  name: 'Desserts',           section: 'food' },
  { id: 8,  name: 'Cupcakes',           section: 'food' },
  { id: 9,  name: 'Ice Cream',          section: 'food' },
  { id: 10, name: 'Coffee',             section: 'bar' },
  { id: 11, name: 'Iced Coffee',        section: 'bar' },
  { id: 12, name: 'Milk-Infused',       section: 'bar' },
  { id: 13, name: 'Juices & Smoothies', section: 'bar' },
  { id: 14, name: 'Tea',                section: 'bar' },
  { id: 15, name: 'Soft Drinks',        section: 'bar' },
];
counters.categoryId = 15;

// ── Orders & amendments ───────────────────────────────────
const orders = [];
const amendments = [];

// ── Settings ──────────────────────────────────────────────
// Mirrors sql/002_seed.sql. Address/phone/email are placeholders until
// the real details arrive (replaced through the admin settings panel).
const settings = {
  restaurant_name: 'Cupcake Delights',
  tagline: 'Freshly baked, every day',
  phone: '[PLACEHOLDER]',
  address: '[PLACEHOLDER - real address pending]',
  email: '[PLACEHOLDER]',
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
