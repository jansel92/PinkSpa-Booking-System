require("dotenv").config();
const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const nodemailer = require("nodemailer");

const app = express();
const db = new Database(path.join(__dirname, "data", "pinkspa.sqlite"));

const PORT = process.env.PORT || 3000;
const OWNER_EMAIL = process.env.OWNER_EMAIL || "admin@pinkspa.com";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "PinkSpa123!";
const SESSION_SECRET = process.env.SESSION_SECRET || "pinkspa-dev-secret-change-me";
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "pinkspaadmin@gmail.com";
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

const uploadsDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
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

let mailTransporter = null;
if (EMAIL_USER && EMAIL_PASS) {
  mailTransporter = nodemailer.createTransport({
    service: "gmail",
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
  `);

  const appointmentColumns = db.prepare("PRAGMA table_info(appointments)").all().map(col => col.name);
  if (!appointmentColumns.includes("duration_minutes")) {
    db.prepare("ALTER TABLE appointments ADD COLUMN duration_minutes INTEGER DEFAULT 60").run();
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

async function sendAppointmentEmail(appointment) {
  if (!mailTransporter) {
    console.log("Email not configured yet. Appointment saved without email notification.");
    return;
  }

  const emailBody = `
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

Please log in to the PinkSpa owner dashboard to review this appointment.
`;

  await mailTransporter.sendMail({
    from: `"PinkSpa Booking" <${EMAIL_USER}>`,
    to: NOTIFY_EMAIL,
    subject: "New PinkSpa Appointment Request",
    text: emailBody
  });
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
    SELECT *
    FROM appointments
    ORDER BY appointment_date DESC, appointment_time DESC, id DESC
  `).all();

  res.json(appts);
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

app.post("/api/appointments", async (req, res) => {
  const {
    client_name,
    client_phone,
    client_email,
    service_id,
    appointment_date,
    appointment_time,
    duration_minutes,
    notes
  } = req.body;

  if (!client_name || !client_phone || !service_id || !appointment_date || !appointment_time) {
    return res.status(400).json({ error: "Name, phone, service, date, and time are required." });
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

  const service = db.prepare("SELECT * FROM services WHERE id = ? AND active = 1").get(service_id);
  if (!service) return res.status(400).json({ error: "Service not found." });

  const cleanAppointmentTime = normalizeTime(appointment_time);
  const requestedStart = timeToMinutes(cleanAppointmentTime);

  if (requestedStart === null) {
    return res.status(400).json({ error: "Invalid appointment time." });
  }

  const requestedDuration = Math.max(
    30,
    Number(duration_minutes || service.duration || 60)
  );

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

  const result = db.prepare(`
    INSERT INTO appointments
    (client_name, client_phone, client_email, service_id, service_name, appointment_date, appointment_time, duration_minutes, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    client_name,
    client_phone,
    client_email || "",
    service_id,
    service.name,
    appointment_date,
    cleanAppointmentTime,
    requestedDuration,
    notes || ""
  );

  const appointment = {
    id: result.lastInsertRowid,
    client_name,
    client_phone,
    client_email: client_email || "",
    service_name: service.name,
    appointment_date,
    appointment_time: cleanAppointmentTime,
    duration_minutes: requestedDuration,
    notes: notes || ""
  };

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
  res.json({ success: true });
});

app.delete("/api/appointments/:id", requireOwner, (req, res) => {
  db.prepare("DELETE FROM appointments WHERE id = ?").run(req.params.id);
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
  console.log(`Owner login email: ${OWNER_EMAIL}`);
});
