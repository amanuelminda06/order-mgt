-- ─────────────────────────────────────────────────────────────
-- Cupcake Delight — 004_menu.sql
-- The REAL Cupcake Delights menu: 15 sections, 114 items.
--
-- Wipes menu_categories + menu_items and reseeds. The wipe REFUSES to run
-- once any order_items row exists, so it can never orphan live orders.
-- Idempotent for repeat runs before orders exist.
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from order_items limit 1) then
    raise exception
      '004_menu.sql refused: order_items already reference menu items. Reseed manually if this is really wanted.';
  end if;
  delete from menu_items;
  delete from menu_categories;
end $$;

-- ── Categories (9 food + 6 drinks) ─────────────────────────
insert into menu_categories (name, name_am, section, sort_order) values
  ('Breakfast',          null, 'food',  1),
  ('Pasta',              null, 'food',  2),
  ('Salads',             null, 'food',  3),
  ('Pizza',              null, 'food',  4),
  ('Main Dish',          null, 'food',  5),
  ('Burger & Sandwich',  null, 'food',  6),
  ('Desserts',           null, 'food',  7),
  ('Cupcakes',           null, 'food',  8),
  ('Ice Cream',          null, 'food',  9),
  ('Coffee',             null, 'drink', 10),
  ('Iced Coffee',        null, 'drink', 11),
  ('Milk-Infused',       null, 'drink', 12),
  ('Juices & Smoothies', null, 'drink', 13),
  ('Tea',                null, 'drink', 14),
  ('Soft Drinks',        null, 'drink', 15);

-- ── Items ──────────────────────────────────────────────────
-- All prices are in ETB and are inclusive of 15% VAT + 10% service charge.
insert into menu_items (name, description, category_id, price, available, sort_order)
select v.name, v.description, c.id, v.price, true, v.ord
from (values
  -- 1. Breakfast
  ('French Toast', 'Topped with peanut, strawberry & cinnamon butter.', 'Breakfast', 500.00, 1),
  ('Waffle/Pancake', 'Topped with peanut, strawberry & cinnamon butter.', 'Breakfast', 500.00, 2),
  ('Mix & Match Egg', 'Eggs any style, hash browns, sausage, garlic, and fruit.', 'Breakfast', 500.00, 3),
  ('Cinnamon Oatmeal', 'Oatmeal combined with fresh strawberry, banana & cinnamon.', 'Breakfast', 450.00, 4),
  ('Ethio Spicy Foul', 'Warm spicy stew of fava beans, onion, tomato, chili, egg and avocado.', 'Breakfast', 450.00, 5),
  ('Avocado Toast Sandwich', 'Brown toast bread topped with sliced avocado and egg.', 'Breakfast', 600.00, 6),
  ('Croissant with Egg & Cheese', 'Fluffy eggs, cheese, and crispy beef slice in a croissant breakfast sandwich.', 'Breakfast', 600.00, 7),
  ('Fasting Avocado Toast', 'Brown toast bread topped with sliced avocado.', 'Breakfast', 500.00, 8),
  ('Chechebsa', 'Torn pieces of homemade flatbread (kita) with honey.', 'Breakfast', 500.00, 9),
  ('Kinche', 'Ethiopian kinche combined with fresh slices of avocado.', 'Breakfast', 500.00, 10),

  -- 2. Pasta
  ('Homemade Lasagna', 'Layers of pasta filled with minced meat sauce, Béchamel, Parmesan and Mozzarella cheese.', 'Pasta', 950.00, 1),
  ('Spaghetti or Rigatoni - Tomato Basil/Veggie', 'Served with tomato basil or veggie sauce.', 'Pasta', 660.00, 2),
  ('Spaghetti or Rigatoni - Bologna', 'Served with rich bologna sauce.', 'Pasta', 749.00, 3),
  ('Spaghetti or Rigatoni - Chicken Alfredo', 'Served with creamy chicken Alfredo sauce.', 'Pasta', 799.00, 4),
  ('Spaghetti or Rigatoni - Tuna', 'Served with tuna sauce.', 'Pasta', 700.00, 5),

  -- 3. Salads
  ('Chicken Salad', 'Fresh salad with chicken, lemon vinaigrette dressing and creamy Italian dressing.', 'Salads', 590.00, 1),
  ('Tuna Salad', 'Fresh salad with tuna, lemon vinaigrette dressing and creamy Italian dressing.', 'Salads', 550.00, 2),
  ('Beef Salad', 'Fresh salad with beef, lemon vinaigrette dressing and creamy Italian dressing.', 'Salads', 590.00, 3),
  ('Salad Bowl', 'Freshly cut avocado, cucumbers, tomatoes, red onions, olive seed, nuts, cherry tomatoes and sweet corn.', 'Salads', 450.00, 4),

  -- 4. Pizza
  ('Pesto Margarita', 'Marinara sauce, cherry tomato, cheese and oregano.', 'Pizza', 599.00, 1),
  ('Rocco Pesto Pizza', 'Basil pesto, sun-dried tomatoes, black olives, mozzarella, tuna and red onion.', 'Pizza', 880.00, 2),
  ('Chicken Pizza', 'Mozzarella cheese, chicken breast, mushroom, red onions and tomato.', 'Pizza', 930.00, 3),
  ('Ortolana Lover', 'Marinara, mushroom, onions, green peppers, spinach, black olives, tomatoes and broccoli.', 'Pizza', 857.00, 4),
  ('Toto E’ Peppion Blanca', 'Spiced tender strips of beef, onion, garlic, pepper, tomato and mozzarella.', 'Pizza', 880.00, 5),
  ('Delight Special Pizza', 'Chicken breast, beef, sausage, cheese, mushroom, onion and black olives.', 'Pizza', 980.00, 6),

  -- 5. Main Dish
  ('Bourbon Steak', 'Pesto mashed potato, button mushroom and brown sauce.', 'Main Dish', 990.00, 1),
  ('Chicken Breast', 'Freshly made sauce with cheese on top, sweet corn, rice and spinach.', 'Main Dish', 990.00, 2),
  ('Chicken or Beef Fajita', 'Juicy chicken or beef, pepper, onion, tomato and guacamole.', 'Main Dish', 950.00, 3),
  ('Combo Fajita', 'Juicy chicken and beef, pepper, onion, tomato and guacamole.', 'Main Dish', 990.00, 4),

  -- 6. Burger & Sandwich
  ('Cheese Burger', 'Grilled beef patties with tomatoes, lettuce, cheese, mayonnaise and sliced onions on a toasted sesame seed bun.', 'Burger & Sandwich', 790.00, 1),
  ('Grilled Chicken Panini', 'Chicken breast, avocado and mayonnaise.', 'Burger & Sandwich', 890.00, 2),
  ('Veggie Sandwich', 'Stacked grilled vegetables on spread guacamole.', 'Burger & Sandwich', 690.00, 3),
  ('Cheese and Steak Sandwich', 'Tender steak, cheese, caramelized onion and toasted garlic butter bread.', 'Burger & Sandwich', 850.00, 4),
  ('Classic Club Sandwich', 'Grilled chicken breast, egg, tomato, cheese, lettuce and mayonnaise.', 'Burger & Sandwich', 890.00, 5),
  ('Tuna Sandwich', 'Tuna chunk sandwich, tomato, onion and sweet corn.', 'Burger & Sandwich', 770.00, 6),

  -- 7. Desserts
  ('Fasting Mille Feuille', null, 'Desserts', 350.00, 1),
  ('Fasting Brownie', null, 'Desserts', 250.00, 2),
  ('Fasting Triple Chocolate', null, 'Desserts', 350.00, 3),
  ('English Cake', null, 'Desserts', 275.00, 4),
  ('Fruit Tart', null, 'Desserts', 230.00, 5),
  ('Chocolate Mousse', null, 'Desserts', 300.00, 6),
  ('Triple Chocolate', null, 'Desserts', 350.00, 7),
  ('Tiramisu', null, 'Desserts', 350.00, 8),
  ('Red Velvet', null, 'Desserts', 350.00, 9),
  ('Choco Caramel', null, 'Desserts', 350.00, 10),
  ('Mille Feuille', null, 'Desserts', 350.00, 11),
  ('Crunch Honey', null, 'Desserts', 350.00, 12),
  ('Cream Puff', null, 'Desserts', 350.00, 13),
  ('Cheese Cake', null, 'Desserts', 500.00, 14),
  ('Pain au Chocolat', null, 'Desserts', 350.00, 15),
  ('Croissant', null, 'Desserts', 350.00, 16),
  ('Cinnamon Roll', null, 'Desserts', 400.00, 17),

  -- 8. Cupcakes
  ('Red Velvet', null, 'Cupcakes', 170.00, 1),
  ('Vanilla', null, 'Cupcakes', 170.00, 2),
  ('Double Choco', null, 'Cupcakes', 170.00, 3),
  ('Choco Vanilla', null, 'Cupcakes', 170.00, 4),
  ('Caramel', null, 'Cupcakes', 170.00, 5),
  ('Fasting Cupcake', null, 'Cupcakes', 170.00, 6),

  -- 9. Ice Cream
  ('Vanilla', null, 'Ice Cream', 200.00, 1),
  ('Strawberry', null, 'Ice Cream', 200.00, 2),
  ('Mocha', null, 'Ice Cream', 200.00, 3),
  ('Chocolate', null, 'Ice Cream', 200.00, 4),
  ('Rum Raisin', null, 'Ice Cream', 200.00, 5),
  ('Oreo Chocolate', null, 'Ice Cream', 200.00, 6),
  ('Caramel', null, 'Ice Cream', 200.00, 7),
  ('Coffee', null, 'Ice Cream', 200.00, 8),

  -- 10. Coffee
  ('Espresso', null, 'Coffee', 155.00, 1),
  ('Tea with Coffee', null, 'Coffee', 155.00, 2),
  ('Latte', null, 'Coffee', 275.00, 3),
  ('Americano', null, 'Coffee', 180.00, 4),
  ('Caramel Macchiato', null, 'Coffee', 250.00, 5),
  ('Double Caramel Macchiato', null, 'Coffee', 385.00, 6),
  ('Macchiato', null, 'Coffee', 180.00, 7),
  ('Black Coffee', null, 'Coffee', 155.00, 8),
  ('Cappuccino', null, 'Coffee', 345.00, 9),
  ('Double Macchiato', null, 'Coffee', 360.00, 10),
  ('Mocha', null, 'Coffee', 405.00, 11),
  ('Fasting Macchiato', null, 'Coffee', 275.00, 12),

  -- 11. Iced Coffee
  ('Vanilla Latte', null, 'Iced Coffee', 385.00, 1),
  ('Spanish Latte', null, 'Iced Coffee', 385.00, 2),
  ('Frappe', null, 'Iced Coffee', 500.00, 3),
  ('Espresso on Ice', null, 'Iced Coffee', 385.00, 4),
  ('Caramel Latte', null, 'Iced Coffee', 385.00, 5),
  ('Ice Latte', null, 'Iced Coffee', 350.00, 6),

  -- 12. Milk-Infused
  ('Milkshake', null, 'Milk-Infused', 495.00, 1),
  ('Milk', null, 'Milk-Infused', 220.00, 2),
  ('Hot Chocolate', null, 'Milk-Infused', 345.00, 3),

  -- 13. Juices & Smoothies
  ('Watermelon', null, 'Juices & Smoothies', 450.00, 1),
  ('Strawberry', null, 'Juices & Smoothies', 499.00, 2),
  ('Papaya', null, 'Juices & Smoothies', 450.00, 3),
  ('Mixed Juice', null, 'Juices & Smoothies', 450.00, 4),
  ('Mango', null, 'Juices & Smoothies', 450.00, 5),
  ('Cucumber with Ginger', null, 'Juices & Smoothies', 450.00, 6),
  ('Avocado', null, 'Juices & Smoothies', 450.00, 7),
  ('Papaya with Flexiseed', null, 'Juices & Smoothies', 499.00, 8),
  ('Mango with Flexiseed', null, 'Juices & Smoothies', 499.00, 9),
  ('Strawberry Smoothie', null, 'Juices & Smoothies', 450.00, 10),
  ('Strawberry & Avocado Smoothie', null, 'Juices & Smoothies', 550.00, 11),
  ('Papaya & Banana Smoothie', null, 'Juices & Smoothies', 490.00, 12),
  ('Mixed Smoothie', null, 'Juices & Smoothies', 500.00, 13),
  ('Avocado & Banana Smoothie', null, 'Juices & Smoothies', 490.00, 14),

  -- 14. Tea
  ('Lemon Tea', null, 'Tea', 165.00, 1),
  ('Ginger Tea', null, 'Tea', 165.00, 2),
  ('Special Tea', null, 'Tea', 299.00, 3),
  ('Green Tea', null, 'Tea', 175.00, 4),
  ('Flavoured Tea', null, 'Tea', 165.00, 5),
  ('Black Tea', null, 'Tea', 125.00, 6),
  ('Tea Latte', null, 'Tea', 220.00, 7),
  ('Ginger Latte', null, 'Tea', 250.00, 8),

  -- 15. Soft Drinks
  ('Water', null, 'Soft Drinks', 125.00, 1),
  ('Sprite', null, 'Soft Drinks', 140.00, 2),
  ('Coca Cola', null, 'Soft Drinks', 140.00, 3),
  ('Novida', null, 'Soft Drinks', 140.00, 4),
  ('Ambo Water', null, 'Soft Drinks', 140.00, 5)
) as v(name, description, cat, price, ord)
join menu_categories c on c.name = v.cat;
