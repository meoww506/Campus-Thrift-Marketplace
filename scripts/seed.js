
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  const categories = [
    'Books & Notes',
    'Electronics',
    'Clothing',
    'Hostel Essentials',
    'Sports',
    'Accessories',
    'Other'
  ];

  // Insert categories
  for (const name of categories) {
    await pool.query(
      'INSERT INTO categories(name) VALUES($1) ON CONFLICT(name) DO NOTHING',
      [name]
    );
  }

  // Create demo accounts
  const accounts = [
    ['Campus Admin', 'admin@campusthrift.bt', 'Admin@123', 'staff', 'admin'],
    ['Demo Student', 'student@campusthrift.bt', 'Student@123', 'student', 'user'],
    ['Demo Staff', 'staff@campusthrift.bt', 'Staff@123', 'staff', 'user']
  ];

  for (const [name, email, password, userType, role] of accounts) {
    const hash = await bcrypt.hash(password, 12);

    await pool.query(
      `INSERT INTO users(full_name,email,password_hash,user_type,role)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(email) DO NOTHING`,
      [name, email, hash, userType, role]
    );
  }

  // Get demo student ID
  const student = await pool.query(
    "SELECT id FROM users WHERE email='student@campusthrift.bt'"
  );

  if (!student.rows.length) {
    throw new Error('Demo student account could not be found.');
  }

  // Get category IDs
  const cats = await pool.query('SELECT id,name FROM categories');
  const cat = Object.fromEntries(
    cats.rows.map(x => [x.name, x.id])
  );

  // Sample products
  const samples = [
    ['Calculus textbook', 'Mathematics textbook in good condition. A few pencil notes inside.', 250, 'Books & Notes', 'Good'],
    ['Desk study lamp', 'Working study lamp, ideal for hostel or room use.', 350, 'Hostel Essentials', 'Like New'],
    ['Badminton racket', 'Lightweight racket. Grip is still in good condition.', 500, 'Sports', 'Good'],
    ['Bluetooth headphones', 'Used carefully and works well. Includes charging cable.', 850, 'Electronics', 'Good']
  ];

  // Insert sample products
  for (const [title, description, price, category, condition] of samples) {
    await pool.query(
  `INSERT INTO listings(
    seller_id, category_id, title, description,
    price, item_condition, status
  )
   SELECT $1,$2,$3,$4,$5,$6,'available'
   WHERE NOT EXISTS (
     SELECT 1 FROM listings
     WHERE title=$7 AND seller_id=$1
   )`,
  [
    student.rows[0].id,
    cat[category],
    title,
    description,
    price,
    condition,
    title
  ]
);
  }

  console.log('Demo data added.');
}

main()
  .catch(err => {
    console.error('Database seeding failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
