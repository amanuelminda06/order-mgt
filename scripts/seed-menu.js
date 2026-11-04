/**
 * Seed Supabase menu_categories and menu_items from the legacy in-memory store.
 *
 * Run once after deploying: node scripts/seed-menu.js
 *
 * Reads categories + items from src/db/memory-store.js, inserts categories
 * first, then items with resolved category_id references and image paths.
 */
require('dotenv').config();
const { categories, menuItems } = require('../src/db/memory-store');
const { select, insert } = require('../src/lib/supabase');

async function seed() {
  console.log('Seeding Supabase menu tables from memory-store...');

  // ── Seed categories ──
  console.log(`  Found ${categories.length} categories in memory-store`);
  for (const cat of categories) {
    const existing = await select('menu_categories', { name: cat.name, section: cat.section }, 'id');
    if (existing.length) {
      console.log(`    skip category '${cat.name}' (already exists)`);
      continue;
    }
    const created = await insert('menu_categories', {
      name: cat.name,
      section: cat.section === 'bar' ? 'drink' : cat.section,
      active: true,
    });
    console.log(`    created category '${cat.name}' id=${created[0].id}`);
  }

  // ── Build category name → id map ──
  const allCats = await select('menu_categories', {}, 'id,name,section');
  const catMap = new Map();
  for (const c of allCats) {
    const key = `${c.section}:${c.name}`;
    catMap.set(key, c.id);
  }

  // ── Seed menu items ──
  console.log(`  Found ${menuItems.length} items in memory-store`);
  let inserted = 0;
  let skipped = 0;
  for (const item of menuItems) {
    const section = item.category === 'bar' ? 'drink' : 'food';
    const key = `${section}:${item.subcategory}`;
    const catId = catMap.get(key);
    if (!catId) {
      console.log(`    skip item '${item.name}' — no category match for ${key}`);
      skipped++;
      continue;
    }

    const existing = await select('menu_items', { name: item.name }, 'id');
    if (existing.length) {
      console.log(`    skip item '${item.name}' (already exists)`);
      skipped++;
      continue;
    }

    await insert('menu_items', {
      name: item.name,
      description: item.description || '',
      category_id: catId,
      price: item.price,
      available: item.available !== false,
      image_path: item.image || '',
    });
    inserted++;
  }

  console.log(`  Inserted ${inserted} items, skipped ${skipped}`);
  console.log('Seed complete.');
}

seed().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
