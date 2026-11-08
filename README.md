# Campus Thrift Marketplace

A campus-focused marketplace for Sherubtse College students and staff to buy and sell pre-owned or unused items. The interface takes inspiration from familiar e-commerce sites while keeping the workflow suitable for a college project.

## Main features

- Student/staff registration and login
- Browse, search and filter available listings
- Product details and seller information
- Create, edit and remove your own listings
- Upload listing photos
- Wishlist
- Purchase requests with accept/reject workflow
- Cash or mobile banking / QR payment selection
- Buyer payment notification and seller payment-receipt confirmation
- Seller dashboard for incoming requests
- Separate admin login and dashboard
- Admin user suspension/reactivation and listing moderation
- Report listings
- Bhutanese-inspired colour palette and subtle textile-style geometric accents
- Prices displayed in Nu. (BTN)

## Technology

- Frontend: EJS, HTML, CSS, Bootstrap 5, vanilla JavaScript
- Backend: Node.js and Express
- Database: PostgreSQL
- Authentication: bcrypt password hashing and Express sessions
- Image uploads: Multer (local uploads for development)

## Requirements

- Node.js 18 or newer
- PostgreSQL 14 or newer
- npm

## Run locally on Windows

1. Install Node.js and PostgreSQL.
2. Create a PostgreSQL database named `campus_thrift`.
3. Open this project folder in VS Code.
4. Copy `.env.example` to `.env`.
5. Update `DATABASE_URL` with your PostgreSQL username and password. Change `SESSION_SECRET` to a long random value.
6. Open the VS Code terminal and run:

```bash
npm install
npm run db:init
npm run db:seed
npm run dev
```

7. Open `http://localhost:3000`.

## Demo accounts

The seed script creates these accounts:

- Admin: `admin@campusthrift.bt` / `Admin@123`
- Student: `student@campusthrift.bt` / `Student@123`
- Staff: `staff@campusthrift.bt` / `Staff@123`

Change these passwords before any public deployment. Demo accounts are for local evaluation only.

## Important routes

| Route | Purpose |
|---|---|
| `/` | Marketplace home |
| `/products` | Browse/search/filter |
| `/products/:id` | Product details |
| `/login` | Student/staff login |
| `/register` | Create student/staff account |
| `/sell` | Create a listing |
| `/dashboard` | My listings and incoming requests |
| `/wishlist` | Saved listings |
| `/my-requests` | Requests made by the signed-in buyer |
| `/admin/login` | Separate admin login |
| `/admin` | Admin dashboard |
| `/admin/users` | Manage campus users |
| `/admin/listings` | Moderate listings |
| `/admin/reports` | Review reports |

## Marketplace workflow

1. A student or staff member registers.
2. The user can browse listings and save items.
3. A buyer sends a purchase request.
4. The buyer selects cash or mobile banking / QR transfer when sending the request.
5. The seller accepts or rejects the request.
6. Buyer and seller arrange payment directly. For cash, they exchange cash at handover. For mobile banking / QR, they exchange payment details directly and the buyer completes the transfer in their own banking app.
7. The buyer marks the payment as sent. The seller independently checks their cash or banking app and confirms receipt.
8. Only after the seller confirms receipt can the seller mark the handover as completed. The listing then becomes sold.

**Payment limitation:** These are manual payment methods, not an online payment gateway. The app does not connect to bank accounts, generate QR codes, receive transaction notifications, or verify transfers automatically. The payment confirmation is a record of what the buyer and seller confirm. Never enter banking PINs, passwords or OTPs into this marketplace.

## Deployment checklist

- Use a managed PostgreSQL database.
- Set `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production` and `PORT` in the hosting dashboard.
- Use persistent object storage (for example Cloudinary or an S3-compatible service) for listing images. Local disk uploads may be erased by some hosting providers after redeployment.
- Set HTTPS and secure cookies in production.
- Change or remove demo accounts and passwords.
- Run database initialization against the production database.
- Test registration, login, listing creation, image upload, purchase requests, admin access and authorization.
- Add a privacy notice and terms suitable for your college before public launch.

## Notes for your viva

Be prepared to explain:
- How Express routes receive requests and return EJS pages.
- Why passwords are hashed with bcrypt.
- How sessions keep a user logged in.
- How PostgreSQL tables are related through primary and foreign keys.
- Why parameterized SQL queries are used.
- How role checks protect admin routes.
- How a purchase request changes from pending to accepted/rejected/completed.
- Why payment status is separate from request status.
- Why the seller must independently verify receipt before confirming payment.
- Why this is manual payment confirmation rather than a payment gateway.

This is a coursework starter implementation. Review, test and adapt it to your lecturer's exact rubric before submission.
