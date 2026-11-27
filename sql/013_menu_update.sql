-- ─────────────────────────────────────────────────────────────
-- Cupcake Delights — 013_menu_update.sql
-- Sync menu prices with the printed menu (Ck menu.pdf, Nov 2026).
-- Idempotent: matches by category + item name, preserves ids, and never
-- touches order_items (each order keeps its own price snapshot).
-- ─────────────────────────────────────────────────────────────

update menu_items i
   set price = v.price,
       updated_at = now()
  from menu_categories c,
       (values
    ('Breakfast', 'French Toast', 600.00),
    ('Breakfast', 'Waffle/Pancake', 600.00),
    ('Breakfast', 'Mix & Match Egg', 650.00),
    ('Breakfast', 'Cinnamon Oatmeal', 600.00),
    ('Breakfast', 'Ethio Spicy Foul', 600.00),
    ('Breakfast', 'Avocado Toast Sandwich', 750.00),
    ('Breakfast', 'Croissant with Egg & Cheese', 750.00),
    ('Breakfast', 'Fasting Avocado Toast', 700.00),
    ('Breakfast', 'Chechebsa', 650.00),
    ('Breakfast', 'Kinche', 650.00),
    ('Pasta', 'Homemade Lasagna', 950.00),
    ('Pasta', 'Spaghetti or Rigatoni - Tomato Basil/Veggie', 800.00),
    ('Pasta', 'Spaghetti or Rigatoni - Bologna', 900.00),
    ('Pasta', 'Spaghetti or Rigatoni - Chicken Alfredo', 1000.00),
    ('Pasta', 'Spaghetti or Rigatoni - Tuna', 900.00),
    ('Salads', 'Chicken Salad', 750.00),
    ('Salads', 'Tuna Salad', 770.00),
    ('Salads', 'Beef Salad', 750.00),
    ('Salads', 'Salad Bowl', 600.00),
    ('Pizza', 'Pesto Margarita', 1000.00),
    ('Pizza', 'Rocco Pesto Pizza', 1000.00),
    ('Pizza', 'Chicken Pizza', 1200.00),
    ('Pizza', 'Ortolana Lover', 1000.00),
    ('Pizza', 'Toto E’ Peppion Blanca', 1000.00),
    ('Pizza', 'Delight Special Pizza', 1200.00),
    ('Main Dish', 'Bourbon Steak', 1400.00),
    ('Main Dish', 'Chicken Breast', 1300.00),
    ('Main Dish', 'Chicken or Beef Fajita', 1200.00),
    ('Main Dish', 'Combo Fajita', 1300.00),
    ('Burger & Sandwich', 'Cheese Burger', 1000.00),
    ('Burger & Sandwich', 'Grilled Chicken Panini', 1200.00),
    ('Burger & Sandwich', 'Veggie Sandwich', 800.00),
    ('Burger & Sandwich', 'Cheese and Steak Sandwich', 1200.00),
    ('Burger & Sandwich', 'Classic Club Sandwich', 1200.00),
    ('Burger & Sandwich', 'Tuna Sandwich', 1000.00),
    ('Desserts', 'Fasting Mille Feuille', 450.00),
    ('Desserts', 'Fasting Brownie', 400.00),
    ('Desserts', 'Fasting Triple Chocolate', 450.00),
    ('Desserts', 'English Cake', 400.00),
    ('Desserts', 'Fruit Tart', 300.00),
    ('Desserts', 'Chocolate Mousse', 400.00),
    ('Desserts', 'Triple Chocolate', 450.00),
    ('Desserts', 'Tiramisu', 450.00),
    ('Desserts', 'Red Velvet', 450.00),
    ('Desserts', 'Choco Caramel', 450.00),
    ('Desserts', 'Mille Feuille', 450.00),
    ('Desserts', 'Crunch Honey', 450.00),
    ('Desserts', 'Cream Puff', 450.00),
    ('Desserts', 'Cheese Cake', 650.00),
    ('Desserts', 'Pain au Chocolat', 450.00),
    ('Desserts', 'Croissant', 400.00),
    ('Desserts', 'Cinnamon Roll', 500.00),
    ('Cupcakes', 'Red Velvet', 250.00),
    ('Cupcakes', 'Vanilla', 250.00),
    ('Cupcakes', 'Double Choco', 250.00),
    ('Cupcakes', 'Choco Vanilla', 250.00),
    ('Cupcakes', 'Caramel', 250.00),
    ('Cupcakes', 'Fasting Cupcake', 170.00),
    ('Ice Cream', 'Vanilla', 200.00),
    ('Ice Cream', 'Strawberry', 200.00),
    ('Ice Cream', 'Mocha', 200.00),
    ('Ice Cream', 'Chocolate', 200.00),
    ('Ice Cream', 'Rum Raisin', 200.00),
    ('Ice Cream', 'Oreo Chocolate', 200.00),
    ('Ice Cream', 'Caramel', 200.00),
    ('Ice Cream', 'Coffee', 200.00),
    ('Coffee', 'Espresso', 170.00),
    ('Coffee', 'Tea with Coffee', 170.00),
    ('Coffee', 'Latte', 290.00),
    ('Coffee', 'Americano', 200.00),
    ('Coffee', 'Caramel Macchiato', 280.00),
    ('Coffee', 'Double Caramel Macchiato', 400.00),
    ('Coffee', 'Macchiato', 200.00),
    ('Coffee', 'Black Coffee', 180.00),
    ('Coffee', 'Cappuccino', 380.00),
    ('Coffee', 'Double Macchiato', 380.00),
    ('Coffee', 'Mocha', 495.00),
    ('Coffee', 'Fasting Macchiato', 300.00),
    ('Iced Coffee', 'Vanilla Latte', 400.00),
    ('Iced Coffee', 'Spanish Latte', 400.00),
    ('Iced Coffee', 'Frappe', 600.00),
    ('Iced Coffee', 'Espresso on Ice', 400.00),
    ('Iced Coffee', 'Caramel Latte', 400.00),
    ('Iced Coffee', 'Ice Latte', 400.00),
    ('Milk-Infused', 'Milkshake', 600.00),
    ('Milk-Infused', 'Milk', 250.00),
    ('Milk-Infused', 'Hot Chocolate', 400.00),
    ('Juices & Smoothies', 'Watermelon', 450.00),
    ('Juices & Smoothies', 'Strawberry', 499.00),
    ('Juices & Smoothies', 'Papaya', 450.00),
    ('Juices & Smoothies', 'Mixed Juice', 450.00),
    ('Juices & Smoothies', 'Mango', 450.00),
    ('Juices & Smoothies', 'Cucumber with Ginger', 450.00),
    ('Juices & Smoothies', 'Avocado', 450.00),
    ('Juices & Smoothies', 'Papaya with Flexiseed', 499.00),
    ('Juices & Smoothies', 'Mango with Flexiseed', 499.00),
    ('Juices & Smoothies', 'Strawberry Smoothie', 450.00),
    ('Juices & Smoothies', 'Strawberry & Avocado Smoothie', 550.00),
    ('Juices & Smoothies', 'Papaya & Banana Smoothie', 490.00),
    ('Juices & Smoothies', 'Mixed Smoothie', 500.00),
    ('Juices & Smoothies', 'Avocado & Banana Smoothie', 490.00),
    ('Tea', 'Lemon Tea', 165.00),
    ('Tea', 'Ginger Tea', 165.00),
    ('Tea', 'Special Tea', 299.00),
    ('Tea', 'Green Tea', 175.00),
    ('Tea', 'Flavoured Tea', 165.00),
    ('Tea', 'Black Tea', 125.00),
    ('Tea', 'Tea Latte', 220.00),
    ('Tea', 'Ginger Latte', 250.00),
    ('Soft Drinks', 'Water', 125.00),
    ('Soft Drinks', 'Sprite', 150.00),
    ('Soft Drinks', 'Coca Cola', 150.00),
    ('Soft Drinks', 'Novida', 150.00),
    ('Soft Drinks', 'Ambo Water', 150.00)
       ) as v(cat, name, price)
 where i.category_id = c.id
   and c.name = v.cat
   and i.name = v.name;

-- Realistic menu photos for the four items added above.
update menu_items i
   set image_path = v.image_path
  from (values
    ('Fasting Croissant', '/uploads/menu/item-119.jpg'),
    ('Fasting Cinnamon', '/uploads/menu/item-120.jpg'),
    ('Continental Strawberry Cake', '/uploads/menu/item-121.jpg'),
    ('Small Macchiato', '/uploads/menu/item-122.jpg')
       ) as v(name, image_path)
 where i.name = v.name;

-- Items on the printed menu that were missing from the database.
insert into menu_items (name, description, category_id, price, available, sort_order)
select v.name, null, c.id, v.price, true, v.ord
  from menu_categories c,
       (values
    ('Desserts', 'Fasting Croissant', 400.00, 54),
    ('Desserts', 'Fasting Cinnamon', 400.00, 55),
    ('Desserts', 'Continental Strawberry Cake', 700.00, 56),
    ('Coffee', 'Small Macchiato', 130.00, 79)
       ) as v(cat, name, price, ord)
 where c.name = v.cat
   and not exists (
     select 1 from menu_items i
      where i.category_id = c.id and i.name = v.name
   );
