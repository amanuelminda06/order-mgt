/**
 * Update Supabase menu_items with image_path from memory-store.
 * Matches items by name to assign the correct image path.
 */
require('dotenv').config();
const { menuItems } = require('../src/db/memory-store');
const { select, update } = require('../src/lib/supabase');

async function updateImages() {
  console.log('Updating image_path for all menu items...');

  // Fetch all items from Supabase with category join
  const items = await select('menu_items', {}, 'id, name, menu_categories(name)');
  console.log(`Found ${items.length} items in Supabase`);

  // Build name -> image map from memory-store
  const memMap = new Map();
  for (const item of menuItems) {
    memMap.set(item.name, item.image);
  }

  let updated = 0;
  let skipped = 0;
  for (const item of items) {
    const imagePath = memMap.get(item.name);
    if (!imagePath) {
      console.log(`  SKIP '${item.name}' — no match in memory-store`);
      skipped++;
      continue;
    }

    await update('menu_items', item.id, { image_path: imagePath });
    updated++;
    if (updated % 20 === 0) console.log(`  ...${updated} updated`);
  }

  console.log(`Updated ${updated} items, skipped ${skipped}`);
}

updateImages().catch((e) => {
  console.error('Update failed:', e.message);
  process.exit(1);
});
