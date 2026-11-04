/**
 * Fix Supabase menu data: add sort_order to categories and items,
 * and backfill image_path for all items from memory-store.
 *
 * Run once: node scripts/fix-supabase-data.js
 */
require('dotenv').config();
const { categories: memCategories, menuItems: memItems } = require('../src/db/memory-store');
const { select, update, del } = require('../src/lib/supabase');

async function fix() {
  console.log('=== Fixing Supabase menu data ===');

  // ── Fix categories: add sort_order (1-15 based on memory-store order) ──
  console.log('\nFixing categories...');
  const supabaseCats = await select('menu_categories', {}, 'id,name,section');
  console.log(`Found ${supabaseCats.length} categories in Supabase`);

  // Build name→sort_order map from memory-store
  const memCatOrder = new Map();
  memCategories.forEach((c, i) => {
    memCatOrder.set(`${c.section === 'bar' ? 'drink' : c.section}:${c.name}`, i + 1);
  });

  for (const cat of supabaseCats) {
    const order = memCatOrder.get(`${cat.section}:${cat.name}`);
    if (order !== undefined) {
      await update('menu_categories', cat.id, { sort_order: order });
      console.log(`  Updated '${cat.name}' sort_order=${order}`);
    }
  }

  // ── Fix items: add sort_order and image_path ──
  console.log('\nFixing items...');
  const supabaseItems = await select('menu_items', {}, 'id, name, menu_categories(name, section)');
  console.log(`Found ${supabaseItems.length} items in Supabase`);

  // Build name→{sort_order, image_path} map from memory-store
  const memItemMap = new Map();
  memItems.forEach(item => {
    memItemMap.set(item.name, { sort_order: item.id, image_path: item.image || '' });
  });

  let updated = 0;
  for (const item of supabaseItems) {
    const mem = memItemMap.get(item.name);
    if (!mem) {
      console.log(`  SKIP '${item.name}' — no match`);
      continue;
    }
    await update('menu_items', item.id, {
      sort_order: mem.sort_order,
      image_path: mem.image_path,
    });
    updated++;
    if (updated % 30 === 0) console.log(`  ...${updated} updated`);
  }

  console.log(`\nUpdated ${updated} items with sort_order and image_path`);
  console.log('=== Fix complete ===');
}

fix().catch((e) => {
  console.error('Fix failed:', e.message);
  process.exit(1);
});
