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

RENDER STARTER PERSISTENT DISK SETUP:
The SQLite database and uploaded files must be stored on a Render Persistent Disk.
Without this disk, appointments, reviews, services, settings, blocked dates, and uploads can be lost during redeploys.

1. Open the PinkSpa Web Service in the Render Dashboard.
2. Open the Disks section and choose Add Disk.
3. Configure the disk:
   - Name: pinkspa-data
   - Mount Path: /var/data
   - Size: 1 GB minimum (increase it as photos and backups grow)
4. Save the disk.
5. Open Environment and add:
   DATA_DIR=/var/data
6. Confirm the existing production secrets are also configured:
   OWNER_EMAIL=<private owner email>
   OWNER_PASSWORD=<strong private password for initial setup>
   SESSION_SECRET=<long random secret>
7. Deploy the latest commit.
8. Check the Render logs. Startup should report:
   - Storage mode: persistent DATA_DIR
   - SQLite database: /var/data/pinkspa.sqlite
   - Service uploads: /var/data/service-uploads
   - Private inspiration uploads: /var/data/inspiration-uploads
9. Create a test service image and test booking with an inspiration photo. Redeploy once and confirm both records and images remain.

IMPORTANT RENDER NOTES:
- The disk mount path and DATA_DIR must match exactly: /var/data
- Attach the disk to this PinkSpa Web Service, not a separate service.
- Keep this SQLite deployment at one running instance. A Render disk is attached to one service instance and SQLite is not intended for multi-instance writes.
- Render disks are not a backup. Back up /var/data/pinkspa.sqlite, /var/data/service-uploads, and /var/data/inspiration-uploads separately.
- Data previously written to Render's ephemeral filesystem is not moved automatically. Re-upload any service images that were created before the persistent disk was attached.
- Local development does not require DATA_DIR. It continues to use data/pinkspa.sqlite, public/uploads, and data/inspiration-uploads.

RENDER EMAIL CONFIRMATION SETUP:
PinkSpa sends branded booking emails with Nodemailer. Booking still succeeds if email delivery is not configured, but owner/client emails will not send until these environment variables are added.

Required Gmail-style setup:
1. Use a dedicated Gmail account or Google Workspace mailbox.
2. Turn on 2-Step Verification for that mailbox.
3. Create a Google App Password for Mail.
4. In Render, open the PinkSpa Web Service, then Environment.
5. Add:
   EMAIL_SERVICE=gmail
   EMAIL_USER=<gmail or workspace email address>
   EMAIL_PASS=<google app password>
   EMAIL_FROM=<same email address or verified sender>
   EMAIL_FROM_NAME=PinkSpa Booking
   NOTIFY_EMAIL=<owner email that receives booking notifications>
   APP_BASE_URL=https://your-render-service.onrender.com
6. Redeploy the service.
7. Submit a test booking with a client email address and confirm:
   - The owner receives a new booking notification.
   - The client receives a branded request confirmation.

Optional SMTP setup instead of Gmail service:
   SMTP_HOST=<smtp provider host>
   SMTP_PORT=587
   SMTP_SECURE=false
   EMAIL_USER=<smtp username>
   EMAIL_PASS=<smtp password>
   EMAIL_FROM=<verified from email>
   EMAIL_FROM_NAME=PinkSpa Booking
   NOTIFY_EMAIL=<owner email>
   APP_BASE_URL=https://your-render-service.onrender.com

EMAIL NOTES:
- For Gmail, EMAIL_PASS must be an App Password, not the normal inbox password.
- APP_BASE_URL is used for owner dashboard, appointment status, and review links inside emails.
- If a booking does not include a client email, PinkSpa will still email the owner but cannot email the client.

NEXT UPGRADES:
- Real SMS reminders using Twilio
- Client account login
- Online deposits/payments with Stripe
- Calendar sync
- Private unavailable day/time blocking
- iPhone/Android installable PWA
