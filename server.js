require("dotenv").config();
const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const nodemailer = require("nodemailer");

const PORT = process.env.PORT || 3000;
const OWNER_EMAIL = process.env.OWNER_EMAIL || "admin@pinkspa.com";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "PinkSpa123!";
const SESSION_SECRET = process.env.SESSION_SECRET || "pinkspa-dev-secret-change-me";
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "pinkspaadmin@gmail.com";
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || EMAIL_USER;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || "PinkSpa Booking";
const APP_BASE_URL = String(process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");

const app = express();

// Render persistent disk setup:
// Mount the disk (recommended: /var/data) and set DATA_DIR to that same path.
// Without DATA_DIR, local development keeps the existing project directories.
const configuredDataDir = String(process.env.DATA_DIR || "").trim();
const dataDir = configuredDataDir
  ? path.resolve(configuredDataDir)
  : path.join(__dirname, "data");
const serviceUploadsDir = configuredDataDir
  ? path.join(dataDir, "service-uploads")
  : path.join(__dirname, "public", "uploads");
const inspirationUploadsDir = path.join(dataDir, "inspiration-uploads");
const databasePath = path.join(dataDir, "pinkspa.sqlite");

[dataDir, serviceUploadsDir, inspirationUploadsDir].forEach(directory => {
  fs.mkdirSync(directory, { recursive: true });
});

const db = new Database(databasePath);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, serviceUploadsDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.toLowerCase().replace(/[^a-z0-9.]/g, "-").replace(/-+/g, "-");
    cb(null, Date.now() + "-" + safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Only image files are allowed."));
    cb(null, true);
  }
});

const inspirationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Inspiration photo must be a JPEG, PNG, or WebP image."));
    }
    cb(null, true);
  }
});

function handleInspirationUpload(req, res, next) {
  inspirationUpload.single("inspiration_image")(req, res, error => {
    if (!error) return next();

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Inspiration photo must be 5MB or smaller." });
    }

    return res.status(400).json({
      error: error.message || "The inspiration photo could not be uploaded."
    });
  });
}

function detectImageExtension(buffer) {
  if (!buffer || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return ".jpg";
  }

  const pngSignature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") === pngSignature) {
    return ".png";
  }

  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return ".webp";
  }

  return null;
}

function resolveInspirationPath(storedPath) {
  if (!storedPath || !storedPath.startsWith("inspiration-uploads/")) return null;
  return path.join(inspirationUploadsDir, path.basename(storedPath));
}

function deleteInspirationFile(storedPath) {
  const imagePath = resolveInspirationPath(storedPath);
  if (!imagePath || !fs.existsSync(imagePath)) return;

  try {
    fs.unlinkSync(imagePath);
  } catch (error) {
    console.error("INSPIRATION IMAGE CLEANUP ERROR:", error);
  }
}

let mailTransporter = null;
if (EMAIL_USER && EMAIL_PASS) {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpSecure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";

  mailTransporter = nodemailer.createTransport(smtpHost
    ? {
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS }
      }
    : {
        service: process.env.EMAIL_SERVICE || "gmail",
        auth: { user: EMAIL_USER, pass: EMAIL_PASS }
      });
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));
// Service images keep their existing /uploads/... URLs while their files live
// on DATA_DIR in production. Inspiration images are intentionally not static.
app.use("/uploads", express.static(serviceUploadsDir, {
  index: false,
  fallthrough: false
}));
app.use(express.static(path.join(__dirname, "public")));

function setupDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS owner (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price TEXT NOT NULL,
      duration INTEGER DEFAULT 60,
      image TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_name TEXT NOT NULL,
      client_phone TEXT NOT NULL,
      client_email TEXT DEFAULT '',
      service_id INTEGER,
      service_name TEXT NOT NULL,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      duration_minutes INTEGER DEFAULT 60,
      inspiration_image TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(service_id) REFERENCES services(id)
    );

    CREATE TABLE IF NOT EXISTS blocked_times (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      block_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      reason TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS business_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      business_name TEXT DEFAULT 'PinkSpa',
      city TEXT DEFAULT 'Homestead, FL',
      phone TEXT DEFAULT '7863036126',
      email TEXT DEFAULT '',
      instagram TEXT DEFAULT '',
      address TEXT DEFAULT '',
      hours TEXT DEFAULT '9:30 AM - 2:30 PM'
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_name TEXT NOT NULL,
      rating INTEGER NOT NULL,
      review_text TEXT NOT NULL,
      approved INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'info',
      icon TEXT DEFAULT '',
      event_key TEXT UNIQUE NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.prepare("CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC, id DESC)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read)").run();

  const appointmentColumns = db.prepare("PRAGMA table_info(appointments)").all().map(col => col.name);
  if (!appointmentColumns.includes("duration_minutes")) {
    db.prepare("ALTER TABLE appointments ADD COLUMN duration_minutes INTEGER DEFAULT 60").run();
  }
  if (!appointmentColumns.includes("inspiration_image")) {
    db.prepare("ALTER TABLE appointments ADD COLUMN inspiration_image TEXT DEFAULT ''").run();
  }

  const owner = db.prepare("SELECT * FROM owner WHERE email = ?").get(OWNER_EMAIL);
  if (!owner) {
    const hash = bcrypt.hashSync(OWNER_PASSWORD, 10);
    db.prepare("INSERT INTO owner (email, password_hash) VALUES (?, ?)").run(OWNER_EMAIL, hash);
  }

  const settings = db.prepare("SELECT * FROM business_settings WHERE id = 1").get();
  if (!settings) {
    db.prepare(`
      INSERT INTO business_settings (id, business_name, city, phone, hours)
      VALUES (1, 'PinkSpa', 'Homestead, FL', '7863036126', '9:30 AM - 2:30 PM')
    `).run();
  }

  pruneNotifications();

  const count = db.prepare("SELECT COUNT(*) AS total FROM services").get().total;
  if (count === 0) {
    const insert = db.prepare("INSERT INTO services (name, category, price, duration, image) VALUES (?, ?, ?, ?, ?)");
    [
      ["Gel Manicure", "Nails", "Set price", 60, "https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=900&q=85"],
      ["Acrylic Full Set", "Nails", "Set price", 90, "https://images.unsplash.com/photo-1632345031435-8727f6897d53?auto=format&fit=crop&w=900&q=85"],
      ["Spa Pedicure", "Pedi", "Set price", 60, "https://images.unsplash.com/photo-1519014816548-bf5fe059798b?auto=format&fit=crop&w=900&q=85"],
      ["Classic Lash Set", "Lashes", "Set price", 120, "https://images.unsplash.com/photo-1589710751893-f9a6770ad71b?auto=format&fit=crop&w=900&q=85"],
      ["Hybrid Lash Set", "Lashes", "Set price", 120, "https://images.unsplash.com/photo-1522338242992-e1a54906a8da?auto=format&fit=crop&w=900&q=85"],
      ["Eyebrow Wax", "Eyebrows", "Set price", 30, "https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=900&q=85"]
    ].forEach(s => insert.run(...s));
  }
}

setupDatabase();

function requireOwner(req, res, next) {
  if (req.session && req.session.owner) return next();
  res.status(401).json({ error: "Unauthorized" });
}

function normalizeTime(t) {
  return String(t || "").trim();
}

function timeToMinutes(time) {
  const clean = normalizeTime(time);
  const match = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3].toUpperCase();

  if (period === "PM" && hour !== 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;

  return hour * 60 + minute;
}

function minutesToTime(total) {
  let hour = Math.floor(total / 60);
  const minute = total % 60;
  const period = hour >= 12 ? "PM" : "AM";

  hour = hour % 12;
  if (hour === 0) hour = 12;

  return `${hour}:${String(minute).padStart(2, "0")} ${period}`;
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function normalizeClientPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeClientEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeClientName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseCurrencyValue(value) {
  const match = String(value || "").replace(/,/g, "").match(/\d+(?:\.\d{1,2})?/);
  return match ? Number(match[0]) : 0;
}

function clientVipLevel(completedVisits) {
  if (completedVisits >= 21) return "Platinum";
  if (completedVisits >= 11) return "Gold";
  if (completedVisits >= 6) return "Silver";
  if (completedVisits >= 3) return "Bronze";
  return "New Client";
}

const VIP_THRESHOLDS = [
  { visits: 21, level: "Platinum" },
  { visits: 11, level: "Gold" },
  { visits: 6, level: "Silver" },
  { visits: 3, level: "Bronze" }
];

function pruneNotifications() {
  db.prepare("DELETE FROM notifications WHERE datetime(created_at) < datetime('now', '-90 days')").run();
  db.prepare(`
    DELETE FROM notifications
    WHERE id NOT IN (
      SELECT id
      FROM notifications
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 100
    )
  `).run();
}

function createNotification({
  type,
  title,
  description,
  priority = "info",
  icon = "i",
  eventKey,
  createdAt
}) {
  if (!type || !title || !description || !eventKey) return;

  const allowedPriorities = new Set(["info", "success", "warning", "important"]);
  const safePriority = allowedPriorities.has(priority) ? priority : "info";
  const insertSql = createdAt
    ? `
      INSERT OR IGNORE INTO notifications
      (type, title, description, priority, icon, event_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    : `
      INSERT OR IGNORE INTO notifications
      (type, title, description, priority, icon, event_key)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
  const params = createdAt
    ? [type, title, description, safePriority, icon, eventKey, createdAt]
    : [type, title, description, safePriority, icon, eventKey];

  db.prepare(insertSql).run(...params);
  pruneNotifications();
}

function appointmentDateTime(appointment) {
  const dateMatch = String(appointment?.appointment_date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const minutes = timeToMinutes(appointment?.appointment_time);
  if (!dateMatch || minutes === null) return null;

  return new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Math.floor(minutes / 60),
    minutes % 60
  );
}

function tomorrowDateKey() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return [
    tomorrow.getFullYear(),
    String(tomorrow.getMonth() + 1).padStart(2, "0"),
    String(tomorrow.getDate()).padStart(2, "0")
  ].join("-");
}

function createStatusNotification(appointment, status) {
  const statusDetails = {
    confirmed: {
      title: "Appointment confirmed",
      description: `${appointment.client_name}'s ${appointment.service_name} appointment is confirmed.`,
      priority: "success",
      icon: "OK"
    },
    completed: {
      title: "Appointment completed",
      description: `${appointment.client_name}'s ${appointment.service_name} appointment was marked completed.`,
      priority: "success",
      icon: "$"
    },
    cancelled: {
      title: "Appointment cancelled",
      description: `${appointment.client_name}'s ${appointment.service_name} appointment was cancelled.`,
      priority: "important",
      icon: "!"
    },
    "no-show": {
      title: "No-show marked",
      description: `${appointment.client_name}'s ${appointment.service_name} appointment was marked as a no-show.`,
      priority: "warning",
      icon: "!"
    }
  };
  const detail = statusDetails[status];
  if (!detail) return;

  createNotification({
    type: `appointment-${status}`,
    title: detail.title,
    description: detail.description,
    priority: detail.priority,
    icon: detail.icon,
    eventKey: `appointment-${appointment.id}-${status}`
  });
}

function contactMatchesSql() {
  return `
    (
      ? != '' AND
      REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(client_phone, '-', ''), '(', ''), ')', ''), ' ', ''), '.', ''), '+', '') = ?
    )
    OR
    (
      ? != '' AND lower(trim(client_email)) = ?
    )
  `;
}

function clientContactKey(appointment) {
  return normalizeClientPhone(appointment.client_phone) ||
    normalizeClientEmail(appointment.client_email) ||
    normalizeClientName(appointment.client_name) ||
    `appointment-${appointment.id}`;
}

function createVipNotificationIfNeeded(appointment) {
  const phone = normalizeClientPhone(appointment.client_phone);
  const email = normalizeClientEmail(appointment.client_email);
  const completedVisits = db.prepare(`
    SELECT COUNT(*) AS total
    FROM appointments
    WHERE status = 'completed'
      AND (${contactMatchesSql()})
  `).get(phone, phone, email, email).total;
  const reached = VIP_THRESHOLDS
    .slice()
    .find(threshold => completedVisits >= threshold.visits);

  if (!reached) return;

  createNotification({
    type: "client-vip",
    title: `${appointment.client_name} reached ${reached.level}`,
    description: `${appointment.client_name} now has ${completedVisits} completed visits and is a ${reached.level} VIP client.`,
    priority: "success",
    icon: "VIP",
    eventKey: `client-vip-${clientContactKey(appointment)}-${reached.level.toLowerCase()}`
  });
}

function generateScheduledNotifications() {
  const now = new Date();
  const soon = new Date(now.getTime() + 60 * 60 * 1000);
  const activeAppointments = db.prepare(`
    SELECT id, client_name, service_name, appointment_date, appointment_time
    FROM appointments
    WHERE status IN ('pending', 'confirmed')
  `).all();

  activeAppointments.forEach(appointment => {
    const startsAt = appointmentDateTime(appointment);
    if (!startsAt || startsAt < now || startsAt > soon) return;

    createNotification({
      type: "appointment-starting",
      title: "Appointment starting soon",
      description: `${appointment.client_name}'s ${appointment.service_name} appointment starts at ${appointment.appointment_time}.`,
      priority: "warning",
      icon: "60",
      eventKey: `appointment-starting-${appointment.id}-${appointment.appointment_date}-${appointment.appointment_time}`
    });
  });

  const tomorrow = tomorrowDateKey();
  const tomorrowAppointments = db.prepare(`
    SELECT COUNT(*) AS total
    FROM appointments
    WHERE appointment_date = ?
      AND status NOT IN ('cancelled', 'no-show')
  `).get(tomorrow).total;

  if (tomorrowAppointments === 0) {
    createNotification({
      type: "tomorrow-empty",
      title: "Tomorrow has no appointments",
      description: "No appointments are scheduled for tomorrow yet.",
      priority: "info",
      icon: "i",
      eventKey: `tomorrow-empty-${tomorrow}`
    });
  }
}

const BOOKING_TIMES = [
  "9:30 AM",
  "10:00 AM",
  "10:30 AM",
  "11:00 AM",
  "11:30 AM",
  "12:00 PM",
  "12:30 PM",
  "1:00 PM",
  "1:30 PM",
  "2:00 PM",
  "2:30 PM"
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function publicUrl(pathname) {
  if (!APP_BASE_URL) return pathname;
  return `${APP_BASE_URL}${pathname}`;
}

function appointmentPlainText(appointment, settings, audience) {
  const statusLink = publicUrl("/#status");
  const reviewLink = publicUrl(`/review?name=${encodeURIComponent(appointment.client_name || "")}`);
  const ownerLink = publicUrl("/owner");

  return audience === "client"
    ? `
${settings.business_name || "PinkSpa"} received your booking request.

Client: ${appointment.client_name}
Phone: ${appointment.client_phone}
Service: ${appointment.service_name}
Date: ${appointment.appointment_date}
Time: ${appointment.appointment_time}
Duration: ${appointment.duration_minutes || 60} minutes

Notes:
${appointment.notes || "No notes provided."}

Status: Pending owner confirmation
Check your status: ${statusLink}
Leave a review after your visit: ${reviewLink}
`
    : `
New PinkSpa Appointment Request

Client Name: ${appointment.client_name}
Phone: ${appointment.client_phone}
Email: ${appointment.client_email || "Not provided"}

Service: ${appointment.service_name}
Date: ${appointment.appointment_date}
Time: ${appointment.appointment_time}
Duration: ${appointment.duration_minutes || 60} minutes

Notes:
${appointment.notes || "No notes provided."}

Status: Pending
Owner Dashboard: ${ownerLink}
Status Link: ${statusLink}
Review Link: ${reviewLink}
`;
}

function bookingEmailHtml({ appointment, settings, audience }) {
  const businessName = escapeHtml(settings.business_name || "PinkSpa");
  const city = escapeHtml(settings.city || "");
  const phone = escapeHtml(settings.phone || "");
  const statusLink = publicUrl("/#status");
  const reviewLink = publicUrl(`/review?name=${encodeURIComponent(appointment.client_name || "")}`);
  const ownerLink = publicUrl("/owner");
  const isClient = audience === "client";
  const title = isClient ? "Your booking request was received" : "New appointment request";
  const intro = isClient
    ? "Thank you for choosing PinkSpa. Your request is pending owner confirmation, and we will follow up soon."
    : "A new client booking request is waiting in the owner dashboard.";
  const ctaUrl = isClient ? statusLink : ownerLink;
  const ctaText = isClient ? "Check Appointment Status" : "Open Owner Dashboard";

  const rows = [
    ["Client", appointment.client_name],
    ["Phone", appointment.client_phone],
    ["Email", appointment.client_email || "Not provided"],
    ["Service", appointment.service_name],
    ["Date", appointment.appointment_date],
    ["Time", appointment.appointment_time],
    ["Duration", `${appointment.duration_minutes || 60} minutes`],
    ["Status", "Pending confirmation"]
  ].map(([label, value]) => `
    <tr>
      <td style="padding:12px 0;color:#8a6675;font-size:13px;font-weight:700;border-bottom:1px solid #ffe3ee;">${escapeHtml(label)}</td>
      <td style="padding:12px 0;color:#3b2330;font-size:14px;font-weight:800;text-align:right;border-bottom:1px solid #ffe3ee;">${escapeHtml(value)}</td>
    </tr>
  `).join("");

  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#fff1f7;font-family:Arial,Helvetica,sans-serif;color:#3b2330;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(title)} for ${businessName}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff1f7;padding:28px 14px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;overflow:hidden;border:1px solid #ffd4e4;border-radius:28px;background:#ffffff;box-shadow:0 18px 50px rgba(151,22,77,.14);">
            <tr>
              <td style="padding:34px 32px;background:linear-gradient(135deg,#ffe0eb,#fff8fb);text-align:center;">
                <div style="margin-bottom:10px;color:#b71956;font-size:12px;font-weight:900;letter-spacing:2px;text-transform:uppercase;">${businessName}</div>
                <h1 style="margin:0;color:#4f112c;font-size:30px;line-height:1.1;letter-spacing:-.5px;">${escapeHtml(title)}</h1>
                <p style="max-width:440px;margin:14px auto 0;color:#7b5b68;font-size:15px;line-height:1.7;">${escapeHtml(intro)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>

                <div style="margin-top:22px;padding:18px;border:1px solid #ffe0eb;border-radius:18px;background:#fff8fb;">
                  <div style="margin-bottom:8px;color:#4f112c;font-size:13px;font-weight:900;">Notes</div>
                  <div style="color:#6f5360;font-size:14px;line-height:1.65;white-space:pre-wrap;">${escapeHtml(appointment.notes || "No notes provided.")}</div>
                </div>

                <div style="margin-top:26px;text-align:center;">
                  <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:linear-gradient(135deg,#ff5f93,#b71956);color:#ffffff;font-size:14px;font-weight:900;text-decoration:none;">${escapeHtml(ctaText)}</a>
                </div>

                <p style="margin:20px 0 0;text-align:center;color:#8a6675;font-size:12px;line-height:1.7;">
                  ${isClient ? `After your visit, you can share your experience here: <a href="${escapeHtml(reviewLink)}" style="color:#b71956;font-weight:800;">Leave a review</a>.` : `Client status link: <a href="${escapeHtml(statusLink)}" style="color:#b71956;font-weight:800;">View status</a> · Review link: <a href="${escapeHtml(reviewLink)}" style="color:#b71956;font-weight:800;">Review page</a>`}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#fff8fb;text-align:center;color:#8a6675;font-size:12px;line-height:1.6;">
                ${businessName}${city ? ` · ${city}` : ""}${phone ? ` · ${phone}` : ""}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendAppointmentEmail(appointment) {
  if (!mailTransporter) {
    console.log("Email not configured yet. Appointment saved without email notification.");
    return;
  }

  const settings = db.prepare("SELECT * FROM business_settings WHERE id = 1").get() || {};
  const from = { name: EMAIL_FROM_NAME, address: EMAIL_FROM || EMAIL_USER };
  const messages = [{
    from,
    to: NOTIFY_EMAIL,
    replyTo: appointment.client_email || undefined,
    subject: `New PinkSpa booking request: ${appointment.client_name}`,
    text: appointmentPlainText(appointment, settings, "owner"),
    html: bookingEmailHtml({ appointment, settings, audience: "owner" })
  }];

  if (appointment.client_email) {
    messages.push({
      from,
      to: appointment.client_email,
      replyTo: settings.email || NOTIFY_EMAIL || EMAIL_FROM || EMAIL_USER,
      subject: `${settings.business_name || "PinkSpa"} received your booking request`,
      text: appointmentPlainText(appointment, settings, "client"),
      html: bookingEmailHtml({ appointment, settings, audience: "client" })
    });
  }

  const results = await Promise.allSettled(messages.map(message => mailTransporter.sendMail(message)));
  const failed = results.filter(result => result.status === "rejected");

  if (failed.length) {
    failed.forEach(result => console.error("EMAIL SEND ERROR:", result.reason));
    throw new Error(`${failed.length} booking email${failed.length === 1 ? "" : "s"} failed to send.`);
  }
}

app.get("/api/settings", (req, res) => {
  const settings = db.prepare("SELECT * FROM business_settings WHERE id = 1").get();
  res.json(settings);
});

app.put("/api/settings", requireOwner, (req, res) => {
  const { business_name, city, phone, email, instagram, address, hours } = req.body;
  db.prepare(`
    UPDATE business_settings
    SET business_name=?, city=?, phone=?, email=?, instagram=?, address=?, hours=?
    WHERE id=1
  `).run(business_name, city, phone, email, instagram, address, hours);

  res.json({ success: true });
});

app.get("/api/services", (req, res) => {
  const services = db.prepare("SELECT * FROM services WHERE active = 1 ORDER BY id DESC").all();
  res.json(services);
});

app.post("/api/upload-service-image", requireOwner, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded." });
  res.json({ success: true, image: "/uploads/" + req.file.filename });
});

app.post("/api/services", requireOwner, (req, res) => {
  const { name, category, price, duration, image } = req.body;
  if (!name || !category || !price) return res.status(400).json({ error: "Name, category, and price are required." });

  const result = db.prepare(`
    INSERT INTO services (name, category, price, duration, image)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, category, price, Number(duration || 60), image || "");

  res.json({ success: true, id: result.lastInsertRowid });
});

app.put("/api/services/:id", requireOwner, (req, res) => {
  const { name, category, price, duration, image, active } = req.body;

  db.prepare(`
    UPDATE services
    SET name=?, category=?, price=?, duration=?, image=?, active=?
    WHERE id=?
  `).run(name, category, price, Number(duration || 60), image || "", active ? 1 : 0, req.params.id);

  res.json({ success: true });
});

app.delete("/api/services/:id", requireOwner, (req, res) => {
  db.prepare("UPDATE services SET active = 0 WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

app.get("/api/appointments", requireOwner, (req, res) => {
  const appts = db.prepare(`
    SELECT a.*, s.price AS service_price
    FROM appointments a
    LEFT JOIN services s ON a.service_id = s.id
    ORDER BY a.appointment_date DESC, a.appointment_time DESC, a.id DESC
  `).all();

  res.json(appts);
});

app.get("/api/clients", requireOwner, (req, res) => {
  const appointments = db.prepare(`
    SELECT a.*, s.price AS service_price
    FROM appointments a
    LEFT JOIN services s ON a.service_id = s.id
    ORDER BY a.appointment_date DESC, a.appointment_time DESC, a.id DESC
  `).all();
  const reviews = db.prepare(`
    SELECT id, client_name, rating, review_text, approved, created_at
    FROM reviews
    ORDER BY created_at DESC, id DESC
  `).all();

  const parent = appointments.map((_, index) => index);
  const find = index => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const phoneOwners = new Map();
  const emailOwners = new Map();

  appointments.forEach((appointment, index) => {
    const phone = normalizeClientPhone(appointment.client_phone);
    const email = normalizeClientEmail(appointment.client_email);

    if (phone) {
      if (phoneOwners.has(phone)) union(index, phoneOwners.get(phone));
      else phoneOwners.set(phone, index);
    }

    if (email) {
      if (emailOwners.has(email)) union(index, emailOwners.get(email));
      else emailOwners.set(email, index);
    }
  });

  const groupedAppointments = new Map();
  appointments.forEach((appointment, index) => {
    const root = find(index);
    if (!groupedAppointments.has(root)) groupedAppointments.set(root, []);
    groupedAppointments.get(root).push(appointment);
  });

  const clients = Array.from(groupedAppointments.values()).map(clientAppointments => {
    const latestAppointment = clientAppointments[0];
    const phone = clientAppointments
      .map(appointment => appointment.client_phone)
      .find(Boolean) || "";
    const email = clientAppointments
      .map(appointment => appointment.client_email)
      .find(Boolean) || "";
    const completedAppointments = clientAppointments.filter(appointment => {
      return appointment.status === "completed";
    });
    const cancelledAppointments = clientAppointments.filter(appointment => {
      return appointment.status === "cancelled";
    });
    const noShowAppointments = clientAppointments.filter(appointment => {
      return appointment.status === "no-show";
    });
    const totalSpent = completedAppointments.reduce((sum, appointment) => {
      return sum + parseCurrencyValue(appointment.service_price);
    }, 0);
    const completedVisitDates = completedAppointments
      .map(appointment => appointment.appointment_date)
      .filter(Boolean)
      .sort();
    const serviceCounts = clientAppointments.reduce((counts, appointment) => {
      const serviceName = appointment.service_name || "Unknown Service";
      counts.set(serviceName, (counts.get(serviceName) || 0) + 1);
      return counts;
    }, new Map());
    const favoriteService = Array.from(serviceCounts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || "-";
    const clientNames = new Set(
      clientAppointments.map(appointment => normalizeClientName(appointment.client_name)).filter(Boolean)
    );

    // Reviews currently have no phone/email, so exact normalized name is the
    // safest available match until the review form captures a client identity.
    const clientReviews = reviews.filter(review => {
      return clientNames.has(normalizeClientName(review.client_name));
    });

    return {
      id: normalizeClientPhone(phone) || normalizeClientEmail(email) || `appointment-${latestAppointment.id}`,
      name: latestAppointment.client_name,
      phone,
      email,
      total_appointments: clientAppointments.length,
      completed_visits: completedAppointments.length,
      cancelled_appointments: cancelledAppointments.length,
      no_shows: noShowAppointments.length,
      total_spent: totalSpent,
      average_appointment_value: completedAppointments.length
        ? totalSpent / completedAppointments.length
        : 0,
      favorite_service: favoriteService,
      first_visit_date: completedVisitDates[0] || "",
      last_visit_date: completedVisitDates[completedVisitDates.length - 1] || "",
      vip_level: clientVipLevel(completedAppointments.length),
      reviews: clientReviews,
      appointments: clientAppointments
        .slice()
        .sort((left, right) => {
          return String(right.appointment_date || "").localeCompare(String(left.appointment_date || "")) ||
            timeToMinutes(right.appointment_time) - timeToMinutes(left.appointment_time) ||
            Number(right.id || 0) - Number(left.id || 0);
        })
        .map(appointment => ({
          id: appointment.id,
          appointment_date: appointment.appointment_date,
          appointment_time: appointment.appointment_time,
          service_name: appointment.service_name,
          status: appointment.status,
          duration_minutes: appointment.duration_minutes || 60,
          estimated_price: parseCurrencyValue(appointment.service_price),
          has_inspiration_photo: Boolean(appointment.inspiration_image)
        })),
      inspiration_photos: clientAppointments
        .filter(appointment => appointment.inspiration_image)
        .map(appointment => ({
          appointment_id: appointment.id,
          appointment_date: appointment.appointment_date,
          service_name: appointment.service_name
        }))
    };
  }).sort((left, right) => {
    return (right.last_visit_date || "").localeCompare(left.last_visit_date || "") ||
      String(left.name || "").localeCompare(String(right.name || ""));
  });

  res.json({ clients });
});

app.get("/api/notifications", requireOwner, (req, res) => {
  generateScheduledNotifications();
  pruneNotifications();

  const notifications = db.prepare(`
    SELECT id, type, title, description, priority, icon, is_read, created_at
    FROM notifications
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 100
  `).all();
  const unread = db.prepare("SELECT COUNT(*) AS total FROM notifications WHERE is_read = 0").get().total;

  res.json({ notifications, unread_count: unread });
});

app.put("/api/notifications/:id/read", requireOwner, (req, res) => {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

app.put("/api/notifications/read-all", requireOwner, (req, res) => {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE is_read = 0").run();
  res.json({ success: true });
});

app.get("/api/appointments/:id/inspiration", requireOwner, (req, res) => {
  const appointment = db.prepare(`
    SELECT inspiration_image
    FROM appointments
    WHERE id = ?
  `).get(req.params.id);

  const imagePath = resolveInspirationPath(appointment?.inspiration_image);
  if (!imagePath || !fs.existsSync(imagePath)) {
    return res.status(404).json({ error: "Inspiration photo not found." });
  }

  res.sendFile(imagePath);
});

app.get("/api/booked-times", (req, res) => {
  const date = String(req.query.date || "").trim();
  const requestedDuration = req.query.duration_minutes === undefined
    ? 30
    : Number(req.query.duration_minutes);

  if (!date) return res.status(400).json({ error: "Date is required." });
  if (!Number.isFinite(requestedDuration) || requestedDuration < 30) {
    return res.status(400).json({ error: "Duration must be at least 30 minutes." });
  }

  const blockedDay = db.prepare(`
    SELECT *
    FROM blocked_times
    WHERE block_date = ?
  `).get(date);

  if (blockedDay) {
    return res.json({
      blocked: true,
      reason: blockedDay.reason || "Unavailable",
      bookedTimes: [],
      bookedAppointments: []
    });
  }

  const bookedAppointments = db.prepare(`
    SELECT
      a.appointment_time,
      COALESCE(a.duration_minutes, s.duration, 60) AS duration_minutes
    FROM appointments a
    LEFT JOIN services s ON a.service_id = s.id
    WHERE a.appointment_date = ?
      AND a.status IN ('pending', 'confirmed')
  `).all(date);

  const occupiedSlots = new Set();

  bookedAppointments.forEach(appt => {
    const start = timeToMinutes(appt.appointment_time);
    const duration = Number(appt.duration_minutes || 60);

    if (start === null) return;

    for (let t = start; t < start + duration; t += 30) {
      occupiedSlots.add(minutesToTime(t));
    }
  });

  const businessEnd = timeToMinutes("2:30 PM") + 30;
  const availableTimes = BOOKING_TIMES.filter(time => {
    const requestedStart = timeToMinutes(time);
    const requestedEnd = requestedStart + requestedDuration;

    if (requestedEnd > businessEnd) return false;

    return bookedAppointments.every(appt => {
      const existingStart = timeToMinutes(appt.appointment_time);
      const existingDuration = Number(appt.duration_minutes || 60);
      if (existingStart === null) return true;

      const existingEnd = existingStart + existingDuration;
      return !rangesOverlap(requestedStart, requestedEnd, existingStart, existingEnd);
    });
  });

  res.json({
    blocked: false,
    bookedTimes: Array.from(occupiedSlots),
    bookedAppointments,
    availableTimes
  });
});

app.get("/api/appointment-status", (req, res) => {
  const phone = String(req.query.phone || "").trim();

  if (!phone) return res.status(400).json({ error: "Phone number is required." });

  const cleanPhone = phone.replace(/\D/g, "");

  const appointments = db.prepare(`
    SELECT id, client_name, client_phone, service_name, appointment_date, appointment_time, duration_minutes, status
    FROM appointments
    WHERE REPLACE(REPLACE(REPLACE(REPLACE(client_phone, '-', ''), '(', ''), ')', ''), ' ', '') LIKE ?
    ORDER BY appointment_date DESC, appointment_time DESC, id DESC
    LIMIT 5
  `).all(`%${cleanPhone}%`);

  res.json({ appointments });
});

app.post("/api/appointments", handleInspirationUpload, async (req, res) => {
  const {
    client_name,
    client_phone,
    client_email,
    service_id,
    selected_service_ids,
    appointment_date,
    appointment_time,
    duration_minutes,
    client_notes,
    notes
  } = req.body;

  if (!client_name || !client_phone || !service_id || !appointment_date || !appointment_time) {
    return res.status(400).json({ error: "Name, phone, service, date, and time are required." });
  }

  const hasStructuredSelection = Boolean(String(selected_service_ids || "").trim());
  const selectedServiceIds = hasStructuredSelection
    ? [...new Set(String(selected_service_ids).split(",").map(id => id.trim()).filter(Boolean))]
    : [String(service_id)];

  if (
    !selectedServiceIds.length ||
    selectedServiceIds.length > 20 ||
    selectedServiceIds.some(id => !/^\d+$/.test(id)) ||
    !selectedServiceIds.includes(String(service_id))
  ) {
    return res.status(400).json({
      error: "The primary service does not match the selected services. Please select your services again."
    });
  }

  const inspirationExtension = req.file
    ? detectImageExtension(req.file.buffer)
    : null;

  if (req.file && !inspirationExtension) {
    return res.status(400).json({
      error: "Inspiration photo must be a valid JPEG, PNG, or WebP image."
    });
  }

  const bookingDate = new Date(appointment_date + "T00:00:00");
  const day = bookingDate.getDay();

  if (day === 0 || day === 6) {
    return res.status(400).json({ error: "PinkSpa is closed on Saturdays and Sundays." });
  }

  const blockedDay = db.prepare(`
    SELECT *
    FROM blocked_times
    WHERE block_date = ?
  `).get(appointment_date);

  if (blockedDay) {
    return res.status(400).json({ error: "This date is unavailable. Please choose another day." });
  }

  const servicePlaceholders = selectedServiceIds.map(() => "?").join(",");
  const matchingServices = db.prepare(`
    SELECT *
    FROM services
    WHERE active = 1 AND id IN (${servicePlaceholders})
  `).all(...selectedServiceIds);

  const serviceById = new Map(
    matchingServices.map(selectedService => [String(selectedService.id), selectedService])
  );
  const selectedServices = selectedServiceIds.map(id => serviceById.get(id));
  const service = serviceById.get(String(service_id));

  if (!service || selectedServices.some(selectedService => !selectedService)) {
    return res.status(400).json({
      error: "One or more selected services are no longer available. Please select your services again."
    });
  }

  const cleanAppointmentTime = normalizeTime(appointment_time);
  const requestedStart = timeToMinutes(cleanAppointmentTime);

  if (requestedStart === null) {
    return res.status(400).json({ error: "Invalid appointment time." });
  }

  const requestedDuration = hasStructuredSelection
    ? Math.max(30, selectedServices.reduce((total, selectedService) => {
        return total + Number(selectedService.duration || 0);
      }, 0))
    : Math.max(30, Number(duration_minutes || service.duration || 60));

  const requestedEnd = requestedStart + requestedDuration;
  const businessEnd = timeToMinutes("2:30 PM") + 30;

  if (requestedEnd > businessEnd) {
    return res.status(409).json({
      error: "There is not enough time available for the selected services at this start time. Please choose an earlier time."
    });
  }

  const existingAppointments = db.prepare(`
    SELECT
      a.appointment_time,
      COALESCE(a.duration_minutes, s.duration, 60) AS duration_minutes
    FROM appointments a
    LEFT JOIN services s ON a.service_id = s.id
    WHERE a.appointment_date = ?
      AND a.status IN ('pending', 'confirmed')
  `).all(appointment_date);

  const hasOverlap = existingAppointments.some(appt => {
    const existingStart = timeToMinutes(appt.appointment_time);
    const existingDuration = Number(appt.duration_minutes || 60);
    if (existingStart === null) return false;

    const existingEnd = existingStart + existingDuration;
    return rangesOverlap(requestedStart, requestedEnd, existingStart, existingEnd);
  });

  if (hasOverlap) {
    return res.status(409).json({
      error: "This appointment overlaps with another appointment. Please choose another time."
    });
  }

  const storedNotes = hasStructuredSelection
    ? `Selected Services: ${selectedServices
        .map(selectedService => `${selectedService.name} (${selectedService.duration} min)`)
        .join(", ")}
Total Estimated Time: ${requestedDuration} minutes

Client Notes:
${String(client_notes || "").trim() || "No notes added."}`
    : notes || "";

  const normalizedClientPhone = normalizeClientPhone(client_phone);
  const normalizedClientEmail = normalizeClientEmail(client_email);
  const existingClientCount = db.prepare(`
    SELECT COUNT(*) AS total
    FROM appointments
    WHERE ${contactMatchesSql()}
  `).get(
    normalizedClientPhone,
    normalizedClientPhone,
    normalizedClientEmail,
    normalizedClientEmail
  ).total;
  const isNewClient = existingClientCount === 0;

  let inspirationImage = "";

  if (req.file) {
    const filename = `${crypto.randomBytes(24).toString("hex")}${inspirationExtension}`;
    inspirationImage = `inspiration-uploads/${filename}`;

    try {
      fs.writeFileSync(resolveInspirationPath(inspirationImage), req.file.buffer, { flag: "wx" });
    } catch (error) {
      console.error("INSPIRATION IMAGE SAVE ERROR:", error);
      return res.status(500).json({
        error: "The inspiration photo could not be saved. Please try again."
      });
    }
  }

  let result;

  try {
    result = db.prepare(`
      INSERT INTO appointments
      (client_name, client_phone, client_email, service_id, service_name, appointment_date, appointment_time, duration_minutes, inspiration_image, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      client_name,
      client_phone,
      client_email || "",
      service_id,
      service.name,
      appointment_date,
      cleanAppointmentTime,
      requestedDuration,
      inspirationImage,
      storedNotes
    );
  } catch (error) {
    deleteInspirationFile(inspirationImage);

    console.error("APPOINTMENT SAVE ERROR:", error);
    return res.status(500).json({
      error: "The appointment request could not be saved. Please try again."
    });
  }

  const appointment = {
    id: result.lastInsertRowid,
    client_name,
    client_phone,
    client_email: client_email || "",
    service_name: service.name,
    appointment_date,
    appointment_time: cleanAppointmentTime,
    duration_minutes: requestedDuration,
    inspiration_image: inspirationImage,
    notes: storedNotes
  };

  createNotification({
    type: "appointment-new",
    title: "New appointment received",
    description: `${client_name} requested ${service.name} on ${appointment_date} at ${cleanAppointmentTime}.`,
    priority: "info",
    icon: "+",
    eventKey: `appointment-new-${result.lastInsertRowid}`
  });

  if (isNewClient) {
    createNotification({
      type: "client-new",
      title: "New client created",
      description: `${client_name} was added from a new booking request.`,
      priority: "success",
      icon: "+",
      eventKey: `client-new-${clientContactKey(appointment)}`
    });
  }

  sendAppointmentEmail(appointment).catch(error => {
    console.error("================================");
    console.error("EMAIL ERROR:");
    console.error(error);
    console.error("================================");
  });

  res.json({ success: true, id: result.lastInsertRowid });
});

app.put("/api/appointments/:id/status", requireOwner, (req, res) => {
  const { status } = req.body;
  const allowed = ["pending", "confirmed", "cancelled", "completed", "no-show"];

  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status." });

  db.prepare("UPDATE appointments SET status = ? WHERE id = ?").run(status, req.params.id);
  const appointment = db.prepare(`
    SELECT id, client_name, client_phone, client_email, service_name, appointment_date, appointment_time, status
    FROM appointments
    WHERE id = ?
  `).get(req.params.id);

  if (appointment) {
    createStatusNotification(appointment, status);
    if (status === "completed") createVipNotificationIfNeeded(appointment);
  }

  res.json({ success: true });
});

app.delete("/api/appointments/:id", requireOwner, (req, res) => {
  const appointment = db.prepare(`
    SELECT inspiration_image
    FROM appointments
    WHERE id = ?
  `).get(req.params.id);

  db.prepare("DELETE FROM appointments WHERE id = ?").run(req.params.id);

  deleteInspirationFile(appointment?.inspiration_image);

  res.json({ success: true });
});

app.get("/api/reviews", (req, res) => {
  const reviews = db.prepare(`
    SELECT id, client_name, rating, review_text, created_at
    FROM reviews
    WHERE approved = 1
    ORDER BY created_at DESC
    LIMIT 12
  `).all();

  res.json({ reviews });
});

app.post("/api/reviews", (req, res) => {
  const { client_name, rating, review_text } = req.body;

  if (!client_name || !rating || !review_text) {
    return res.status(400).json({ error: "Name, rating, and review are required." });
  }

  const numericRating = Number(rating);

  if (numericRating < 1 || numericRating > 5) {
    return res.status(400).json({ error: "Rating must be between 1 and 5." });
  }

  const result = db.prepare(`
    INSERT INTO reviews (client_name, rating, review_text, approved)
    VALUES (?, ?, ?, 0)
  `).run(
    String(client_name).trim(),
    numericRating,
    String(review_text).trim()
  );

  createNotification({
    type: "review-new",
    title: "New review waiting approval",
    description: `${String(client_name).trim()} submitted a ${numericRating}-star review.`,
    priority: "warning",
    icon: "*",
    eventKey: `review-new-${result.lastInsertRowid}`
  });

  res.json({
    success: true,
    id: result.lastInsertRowid,
    message: "Thank you! Your review was submitted and will be reviewed by PinkSpa."
  });
});

app.get("/api/admin/reviews", requireOwner, (req, res) => {
  const reviews = db.prepare(`
    SELECT *
    FROM reviews
    ORDER BY created_at DESC
  `).all();

  res.json({ reviews });
});

app.put("/api/admin/reviews/:id/approve", requireOwner, (req, res) => {
  db.prepare("UPDATE reviews SET approved = 1 WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

app.put("/api/admin/reviews/:id/unapprove", requireOwner, (req, res) => {
  db.prepare("UPDATE reviews SET approved = 0 WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

app.delete("/api/admin/reviews/:id", requireOwner, (req, res) => {
  db.prepare("DELETE FROM reviews WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

app.get("/api/blocked-days", requireOwner, (req, res) => {
  const days = db.prepare(`
    SELECT *
    FROM blocked_times
    ORDER BY block_date ASC
  `).all();

  res.json(days);
});

app.post("/api/blocked-days", requireOwner, (req, res) => {
  const { block_date, reason } = req.body;

  if (!block_date) return res.status(400).json({ error: "Date is required." });

  const existing = db.prepare(`
    SELECT *
    FROM blocked_times
    WHERE block_date = ?
  `).get(block_date);

  if (existing) return res.status(409).json({ error: "This date is already blocked." });

  db.prepare(`
    INSERT INTO blocked_times (block_date, start_time, end_time, reason)
    VALUES (?, '', '', ?)
  `).run(block_date, reason || "Unavailable");

  res.json({ success: true });
});

app.delete("/api/blocked-days/:id", requireOwner, (req, res) => {
  db.prepare("DELETE FROM blocked_times WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const owner = db.prepare("SELECT * FROM owner WHERE email = ?").get(email);

  if (!owner || !bcrypt.compareSync(password, owner.password_hash)) {
    return res.status(401).json({ error: "Invalid login." });
  }

  req.session.owner = { id: owner.id, email: owner.email };
  res.json({ success: true });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get("/api/me", (req, res) => {
  res.json({ owner: req.session.owner || null });
});

app.get("/review", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "review.html"));
});

app.get("/owner", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "owner.html"));
});

app.listen(PORT, () => {
  console.log(`PinkSpa booking system running on port ${PORT}`);
  console.log(`Storage mode: ${configuredDataDir ? "persistent DATA_DIR" : "local development"}`);
  console.log(`SQLite database: ${databasePath}`);
  console.log(`Service uploads: ${serviceUploadsDir}`);
  console.log(`Private inspiration uploads: ${inspirationUploadsDir}`);
  console.log(`Owner login email: ${OWNER_EMAIL}`);
});
