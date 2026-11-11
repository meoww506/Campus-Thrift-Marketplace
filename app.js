require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const helmet = require('helmet');
const methodOverride = require('method-override');
const { body, validationResult } = require('express-validator');

const app = express();
app.set('trust proxy', 1);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random()*1e9)}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg','image/png','image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPG, PNG and WEBP images are allowed.'), ok);
  }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));
app.use(session({
  store: new pgSession({ 
    pool, 
    createTableIfMissing: true
   }),
  secret: process.env.SESSION_SECRET || 'development-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, 
    sameSite: 'lax', 
    secure: process.env.NODE_ENV === 'production', 
    maxAge: 1000 * 60 * 60 * 8 
  }
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.notice = req.session.notice || null;
  delete req.session.notice;
  next();
});


function requireLogin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }

  if (req.session.user.is_suspended) {
    req.session.destroy(() => {
      res.redirect('/login?blocked=1');
    });
    return;
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/admin/login');
  }

  if (req.session.user.is_suspended) {
    req.session.destroy(() => {
      res.redirect('/admin/login');
    });
    return;
  }

  next();
}
function setNotice(req, message, type='success') { req.session.notice = { message, type }; }
function validationMessage(req, res, fallback) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    setNotice(req, errors.array()[0].msg, 'danger');
    return res.redirect('back');
  }
  return null;
}

app.get('/', async (req, res, next) => {
  try {
    const [items, categories] = await Promise.all([
      pool.query(`SELECT l.*, c.name AS category_name, u.full_name AS seller_name
        FROM listings l LEFT JOIN categories c ON c.id=l.category_id
        JOIN users u ON u.id=l.seller_id
        WHERE l.status='available' AND u.is_suspended=false
        ORDER BY l.created_at DESC LIMIT 8`),
      pool.query('SELECT * FROM categories ORDER BY name')
    ]);
    res.render('home', { items: items.rows, categories: categories.rows });
  } catch (e) { next(e); }
});

app.get('/products', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const category = req.query.category || '';
    const condition = req.query.condition || '';
    const params = [];
    let where = "WHERE l.status='available' AND u.is_suspended=false";
    if (q) { params.push(`%${q}%`); where += ` AND (l.title ILIKE $${params.length} OR l.description ILIKE $${params.length})`; }
    if (category) { params.push(category); where += ` AND l.category_id=$${params.length}`; }
    if (condition) { params.push(condition); where += ` AND l.item_condition=$${params.length}`; }
    const [items, categories] = await Promise.all([
      pool.query(`SELECT l.*, c.name AS category_name, u.full_name AS seller_name
        FROM listings l LEFT JOIN categories c ON c.id=l.category_id
        JOIN users u ON u.id=l.seller_id ${where} ORDER BY l.created_at DESC`, params),
      pool.query('SELECT * FROM categories ORDER BY name')
    ]);
    res.render('products', { items: items.rows, categories: categories.rows, filters: { q, category, condition } });
  } catch (e) { next(e); }
});

app.get('/products/:id', async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT l.*, c.name AS category_name, u.full_name AS seller_name, u.user_type AS seller_type
      FROM listings l LEFT JOIN categories c ON c.id=l.category_id JOIN users u ON u.id=l.seller_id WHERE l.id=$1`, [req.params.id]);
    if (!result.rows.length) return res.status(404).render('error', { message: 'This listing could not be found.' });
    const listing = result.rows[0];
    const wished = req.session.user ? await pool.query('SELECT 1 FROM wishlists WHERE user_id=$1 AND listing_id=$2', [req.session.user.id, listing.id]) : { rowCount: 0 };
    res.render('product-detail', { listing, wished: wished.rowCount > 0 });
  } catch (e) { next(e); }
});

// ===============================
// STUDENT AND STAFF LOGIN
// ===============================

app.get('/login', (req, res) => {
  res.render('auth/login');
});

app.post('/login', async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND role = 'user'",
      [email]
    );

    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      setNotice(req, 'Email or password is incorrect.', 'danger');
      return res.redirect('/login');
    }

    if (user.is_suspended) {
      setNotice(
        req,
        'Your account is currently suspended. Contact the marketplace administrator.',
        'danger'
      );
      return res.redirect('/login');
    }

    req.session.user = {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      user_type: user.user_type,
      role: user.role,
      is_suspended: user.is_suspended
    };

    res.redirect('/');
  } catch (error) {
    next(error);
  }
});

app.get('/register', (req,res) => res.render('auth/register'));
app.post('/register',
  body('full_name').trim().isLength({min:2,max:120}).withMessage('Enter your full name.'),
  body('email').trim().isEmail().withMessage('Enter a valid email address.'),
  body('password').isLength({min:8}).withMessage('Password must contain at least 8 characters.'),
  async (req,res,next) => {
    if (validationMessage(req,res)) return;
    try {
      const { full_name,email,password,user_type,campus_id,phone } = req.body;
      if (!['student','staff'].includes(user_type)) { setNotice(req,'Choose student or staff.','danger'); return res.redirect('/register'); }
      const hash = await bcrypt.hash(password, 12);
      const result = await pool.query(
        `INSERT INTO users(full_name,email,password_hash,user_type,campus_id,phone)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id,full_name,email,user_type,role,is_suspended`,
        [full_name,email.toLowerCase(),hash,user_type,campus_id || null,phone || null]
      );
      req.session.user = result.rows[0];
      res.redirect('/');
    } catch(e) {
      if (e.code === '23505') { setNotice(req,'That email is already registered.','danger'); return res.redirect('/register'); }
      next(e);
    }
  }
);
// ===============================
// ADMIN LOGIN
// ===============================

app.get('/admin/login', (req, res) => {
  res.render('auth/admin-login');
});

app.post('/admin/login', async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND role = 'admin'",
      [(req.body.email || '').trim().toLowerCase()]
    );

    const user = result.rows[0];

    // Check whether the admin account exists and password is correct
    if (!user || !(await bcrypt.compare(
      req.body.password || '',
      user.password_hash
    ))) {
      setNotice(
        req,
        'Admin email or password is incorrect.',
        'danger'
      );

      return res.redirect('/admin/login');
    }

    // Check whether the admin account is suspended
    if (user.is_suspended) {
      setNotice(
        req,
        'This administrator account is suspended.',
        'danger'
      );

      return res.redirect('/admin/login');
    }

    // Create admin session
    req.session.user = {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      user_type: user.user_type,
      role: user.role,
      is_suspended: user.is_suspended
    };

    // Redirect to admin dashboard
    res.redirect('/admin');

  } catch (error) {
    next(error);
  }
});

app.post('/logout', requireLogin, (req,res) => req.session.destroy(() => res.redirect('/')));
app.post('/admin/logout', requireAdmin, (req,res) => req.session.destroy(() => res.redirect('/')));

app.get('/sell', requireLogin, async (req,res,next) => {
  try { const cats = await pool.query('SELECT * FROM categories ORDER BY name'); res.render('sell', { categories: cats.rows }); }
  catch(e) { next(e); }
});
app.post('/sell', requireLogin, upload.single('photo'),
  body('title').trim().isLength({min:3,max:150}).withMessage('Title must be 3 to 150 characters.'),
  body('description').trim().isLength({min:10}).withMessage('Please add a useful description.'),
  body('price').isFloat({min:0}).withMessage('Enter a valid price.'),
  async (req,res,next) => {
    if (validationMessage(req,res)) return;
    try {
      const { title,description,price,category_id,item_condition } = req.body;
      const imagePath = req.file ? `/uploads/${req.file.filename}` : null;
      await pool.query(
        `INSERT INTO listings(seller_id,category_id,title,description,price,item_condition,image_path)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [req.session.user.id,category_id || null,title,description,price,item_condition || 'Good',imagePath]
      );
      setNotice(req,'Your item has been listed successfully.'); res.redirect('/dashboard');
    } catch(e) { next(e); }
  }
);

app.get('/dashboard', requireLogin, async (req,res,next) => {
  try {
    const [listings, requests] = await Promise.all([
      pool.query('SELECT * FROM listings WHERE seller_id=$1 ORDER BY created_at DESC', [req.session.user.id]),
      pool.query(`SELECT pr.*, l.title, l.price, u.full_name AS buyer_name
        FROM purchase_requests pr JOIN listings l ON l.id=pr.listing_id JOIN users u ON u.id=pr.buyer_id
        WHERE pr.seller_id=$1 ORDER BY pr.created_at DESC`, [req.session.user.id])
    ]);
    res.render('dashboard', { listings:listings.rows, requests:requests.rows });
  } catch(e) { next(e); }
});

app.post('/listings/:id/status', requireLogin, async (req,res,next) => {
  try {
    const allowed = ['available','removed'];
    if (!allowed.includes(req.body.status)) { setNotice(req,'Invalid listing action.','danger'); return res.redirect('/dashboard'); }
    const result = await pool.query('UPDATE listings SET status=$1,updated_at=NOW() WHERE id=$2 AND seller_id=$3 RETURNING id',
      [req.body.status,req.params.id,req.session.user.id]);
    setNotice(req,result.rowCount ? 'Listing updated.' : 'You cannot change that listing.'); res.redirect('/dashboard');
  } catch(e) { next(e); }
});

app.post('/products/:id/wishlist', requireLogin, async (req,res,next) => {
  try {
    await pool.query('INSERT INTO wishlists(user_id,listing_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.session.user.id,req.params.id]);
    res.redirect(req.get('referer') || '/wishlist');
  } catch(e) { next(e); }
});
app.delete('/wishlist/:id', requireLogin, async (req,res,next) => {
  try { await pool.query('DELETE FROM wishlists WHERE user_id=$1 AND listing_id=$2',[req.session.user.id,req.params.id]); res.redirect('/wishlist'); }
  catch(e) { next(e); }
});
app.get('/wishlist', requireLogin, async (req,res,next) => {
  try {
    const r = await pool.query(`SELECT l.*, c.name AS category_name FROM wishlists w JOIN listings l ON l.id=w.listing_id
      LEFT JOIN categories c ON c.id=l.category_id WHERE w.user_id=$1 ORDER BY w.created_at DESC`, [req.session.user.id]);
    res.render('wishlist',{items:r.rows});
  } catch(e) { next(e); }
});

app.post('/products/:id/request', requireLogin, async (req,res,next) => {
  try {
    const item = await pool.query("SELECT * FROM listings WHERE id=$1 AND status='available'",[req.params.id]);
    if (!item.rows.length) { setNotice(req,'This item is no longer available.','danger'); return res.redirect('/products'); }
    if (item.rows[0].seller_id === req.session.user.id) { setNotice(req,'You cannot request your own item.','danger'); return res.redirect(`/products/${req.params.id}`); }
    const paymentMethod = req.body.payment_method;
    if (!['cash','mobile_transfer'].includes(paymentMethod)) {
      setNotice(req,'Choose a valid payment method.','danger'); return res.redirect(`/products/${req.params.id}`);
    }
    await pool.query(
      `INSERT INTO purchase_requests(listing_id,buyer_id,seller_id,message,payment_method,payment_status)
       VALUES($1,$2,$3,$4,$5,'awaiting_payment')
       ON CONFLICT(listing_id,buyer_id) DO UPDATE
       SET status='pending',message=EXCLUDED.message,payment_method=EXCLUDED.payment_method,
           payment_status='awaiting_payment',updated_at=NOW()`,
      [req.params.id,req.session.user.id,item.rows[0].seller_id,req.body.message || null,paymentMethod]
    );
    setNotice(req,'Purchase request sent. Payment is arranged directly with the seller after acceptance.'); res.redirect('/my-requests');
  } catch(e) { next(e); }
});
app.get('/my-requests', requireLogin, async (req,res,next) => {
  try {
    const r = await pool.query(`SELECT pr.*,l.title,l.price,u.full_name AS seller_name FROM purchase_requests pr
      JOIN listings l ON l.id=pr.listing_id JOIN users u ON u.id=pr.seller_id
      WHERE pr.buyer_id=$1 ORDER BY pr.created_at DESC`,[req.session.user.id]);
    res.render('my-requests',{requests:r.rows});
  } catch(e) { next(e); }
});
app.post('/requests/:id/status', requireLogin, async (req,res,next) => {
  try {
    const status = req.body.status;
    if (!['accepted','rejected','completed','cancelled'].includes(status)) { setNotice(req,'Invalid request action.','danger'); return res.redirect('/dashboard'); }
    const result = await pool.query('SELECT * FROM purchase_requests WHERE id=$1',[req.params.id]);
    const request = result.rows[0];
    if (!request) { setNotice(req,'Request not found.','danger'); return res.redirect('/dashboard'); }
    const isSeller = request.seller_id === req.session.user.id;
    const isBuyer = request.buyer_id === req.session.user.id;
    if ((['accepted','rejected','completed'].includes(status) && !isSeller) || (status==='cancelled' && !isBuyer)) {
      setNotice(req,'You are not allowed to perform that action.','danger'); return res.redirect('/dashboard');
    }
    const valid = (status==='accepted' || status==='rejected') ? request.status==='pending'
      : status==='completed' ? request.status==='accepted' && request.payment_status==='confirmed'
      : ['pending','accepted'].includes(request.status);
    if (!valid) {
      const message = status==='completed' && request.payment_status!=='confirmed'
        ? 'Confirm payment receipt before completing the handover.'
        : 'That status change is not allowed.';
      setNotice(req,message,'danger'); return res.redirect('/dashboard');
    }
    await pool.query('UPDATE purchase_requests SET status=$1,updated_at=NOW() WHERE id=$2',[status,request.id]);
    if (status==='accepted') await pool.query("UPDATE listings SET status='reserved' WHERE id=$1",[request.listing_id]);
    if (status==='rejected' || status==='cancelled') await pool.query("UPDATE listings SET status='available' WHERE id=$1 AND status='reserved'",[request.listing_id]);
    if (status==='completed') {
      await pool.query("UPDATE listings SET status='sold' WHERE id=$1",[request.listing_id]);
      await pool.query("UPDATE purchase_requests SET status='rejected',updated_at=NOW() WHERE listing_id=$1 AND id<>$2 AND status='pending'",[request.listing_id,request.id]);
    }
    setNotice(req,'Purchase request updated.'); res.redirect(isSeller ? '/dashboard' : '/my-requests');
  } catch(e) { next(e); }
});

app.post('/requests/:id/payment', requireLogin, async (req,res,next) => {
  try {
    const result = await pool.query('SELECT * FROM purchase_requests WHERE id=$1',[req.params.id]);
    const request = result.rows[0];
    if (!request) { setNotice(req,'Request not found.','danger'); return res.redirect('/my-requests'); }
    if (request.status !== 'accepted') {
      setNotice(req,'Payment can only be updated for an accepted request.','danger');
      return res.redirect(request.buyer_id===req.session.user.id ? '/my-requests' : '/dashboard');
    }

    if (req.body.action === 'buyer_paid' && request.buyer_id === req.session.user.id) {
      if (request.payment_status !== 'awaiting_payment') {
        setNotice(req,'This payment has already been submitted for confirmation.','danger');
        return res.redirect('/my-requests');
      }
      await pool.query(
        `UPDATE purchase_requests SET payment_status='buyer_marked_paid',updated_at=NOW() WHERE id=$1`,
        [request.id]
      );
      setNotice(req,'Payment marked as sent. The seller must verify receipt before the order can be completed.');
      return res.redirect('/my-requests');
    }

    if (req.body.action === 'seller_confirm' && request.seller_id === req.session.user.id) {
      if (request.payment_status !== 'buyer_marked_paid') {
        setNotice(req,'The buyer has not marked the payment as sent.','danger');
        return res.redirect('/dashboard');
      }
      await pool.query(
        `UPDATE purchase_requests SET payment_status='confirmed',updated_at=NOW() WHERE id=$1`,
        [request.id]
      );
      setNotice(req,'Payment receipt confirmed. You can now mark the handover as completed.');
      return res.redirect('/dashboard');
    }

    setNotice(req,'You are not allowed to perform that payment action.','danger');
    res.redirect(request.buyer_id===req.session.user.id ? '/my-requests' : '/dashboard');
  } catch(e) { next(e); }
});

app.post('/products/:id/report', requireLogin, async (req,res,next) => {
  try {
    if (!(req.body.reason || '').trim()) { setNotice(req,'Please explain why you are reporting this listing.','danger'); return res.redirect(`/products/${req.params.id}`); }
    await pool.query('INSERT INTO reports(listing_id,reporter_id,reason) VALUES($1,$2,$3)',[req.params.id,req.session.user.id,req.body.reason.trim()]);
    setNotice(req,'Report submitted to the administrator.'); res.redirect(`/products/${req.params.id}`);
  } catch(e) { next(e); }
});

/* Admin area */
app.get('/admin', requireAdmin, async (req,res,next) => {
  try {
    const [users,listings,requests,reports] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='user'"),
      pool.query("SELECT COUNT(*)::int AS n FROM listings"),
      pool.query("SELECT COUNT(*)::int AS n FROM purchase_requests"),
      pool.query("SELECT COUNT(*)::int AS n FROM reports WHERE status='open'")
    ]);
    res.render('admin/dashboard',{stats:{users:users.rows[0].n,listings:listings.rows[0].n,requests:requests.rows[0].n,reports:reports.rows[0].n}});
    } catch (error) {
    next(error);
  }
});
app.get('/admin/users', requireAdmin, async (req,res,next) => {
  try { const r=await pool.query("SELECT id,full_name,email,user_type,is_suspended,created_at FROM users WHERE role='user' ORDER BY created_at DESC"); res.render('admin/users',{users:r.rows}); }
  catch(e) { next(e); }
});
app.post('/admin/users/:id/toggle', requireAdmin, async (req,res,next) => {
  try { await pool.query("UPDATE users SET is_suspended=NOT is_suspended WHERE id=$1 AND role='user'",[req.params.id]); setNotice(req,'User status updated.'); res.redirect('/admin/users'); }
  catch(e) { next(e); }
});
app.get('/admin/listings', requireAdmin, async (req,res,next) => {
  try { const r=await pool.query(`SELECT l.*,u.full_name AS seller_name,c.name AS category_name FROM listings l
    JOIN users u ON u.id=l.seller_id LEFT JOIN categories c ON c.id=l.category_id ORDER BY l.created_at DESC`); res.render('admin/listings',{items:r.rows}); }
  catch(e) { next(e); }
});
app.post('/admin/listings/:id/remove', requireAdmin, async (req,res,next) => {
  try { await pool.query("UPDATE listings SET status='removed' WHERE id=$1",[req.params.id]); setNotice(req,'Listing removed from the marketplace.'); res.redirect('/admin/listings'); }
  catch(e) { next(e); }
});
app.get('/admin/reports', requireAdmin, async (req,res,next) => {
  try { const r=await pool.query(`SELECT rp.*,l.title,u.full_name AS reporter_name FROM reports rp
    JOIN listings l ON l.id=rp.listing_id JOIN users u ON u.id=rp.reporter_id ORDER BY rp.created_at DESC`); res.render('admin/reports',{reports:r.rows}); }
  catch(e) { next(e); }
});
app.post('/admin/reports/:id/status', requireAdmin, async (req,res,next) => {
  try {
    const status = ['reviewed','dismissed'].includes(req.body.status) ? req.body.status : 'reviewed';
    await pool.query('UPDATE reports SET status=$1 WHERE id=$2',[status,req.params.id]); setNotice(req,'Report status updated.'); res.redirect('/admin/reports');
  } catch(e) { next(e); }
});

app.get('/health', (_req,res) => res.json({ status:'ok' }));
app.use((err,req,res,_next) => {
  console.error(err);
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 3 MB or smaller.' : (err.message || 'Something went wrong.');
  res.status(500).render('error',{message});
});
app.use((_req,res) => res.status(404).render('error',{message:'The page you are looking for does not exist.'}));

app.listen(PORT, () => console.log(`Campus Thrift running at http://localhost:${PORT}`));
