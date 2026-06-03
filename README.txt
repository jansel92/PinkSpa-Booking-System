PINKSPA FULL BOOKING SYSTEM

This is a full-stack booking system for PinkSpa.

Included:
- Public professional website
- Client appointment request form
- Owner login
- Owner dashboard
- Add/remove services
- Customize service names, categories, prices, duration, images
- View appointment requests
- Confirm/cancel/complete appointments
- Business settings: phone, city, hours, Instagram, address, email
- SQLite database

Business info already included:
- PinkSpa
- Homestead, FL
- Phone: 7863036126
- Hours: 9:30 AM - 2:30 PM

OWNER LOGIN:
Email: admin@pinkspa.com
Password: PinkSpa123!

HOW TO RUN LOCALLY:
1. Install Node.js from nodejs.org
2. Open this folder in Terminal / Command Prompt
3. Run:
   npm install
4. Run:
   npm start
5. Open:
   http://localhost:3000

Owner dashboard:
http://localhost:3000/owner

IMPORTANT SECURITY:
Before publishing live:
- Change OWNER_EMAIL and OWNER_PASSWORD in .env
- Change SESSION_SECRET
- Use HTTPS
- Use a real production host
- Consider adding SMS reminders, payment deposits, and email notifications

HOW TO DEPLOY:
This app can be deployed to Render, Railway, Fly.io, or a VPS.
For Vercel/Netlify, this exact Node + SQLite version needs changes because SQLite local storage is not persistent there.

NEXT UPGRADES:
- Real SMS reminders using Twilio
- Email confirmations
- Client account login
- Online deposits/payments with Stripe
- Calendar sync
- Private unavailable day/time blocking
- iPhone/Android installable PWA
