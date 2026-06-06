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

const EMAIL_HOST = process.env.EMAIL_HOST;
const EMAIL_PORT = Number(process.env.EMAIL_PORT || 587);
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

const uploadsDir = path.join(__dirname, "public", "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const safeName = file.originalname
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, "-")
      .replace(/-+/g, "-");

    const uniqueName = Date.now() + "-" + safeName;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed."));
    }

    cb(null, true);
  }
});

let mailTransporter = null;

if (EMAIL_USER && EMAIL_PASS) {
  mailTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS
    }
  });
}

app.use(helmet({
  contentSecurityPolicy: false
}));
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
  `);

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
    const starter = [
      ["Gel Manicure", "Nails", "Set price", 60, "https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=900&q=85"],
      ["Acrylic Full Set", "Nails", "Set price", 90, "https://images.unsplash.com/photo-1632345031435-8727f6897d53?auto=format&fit=crop&w=900&q=85"],
      ["Spa Pedicure", "Pedi", "Set price", 60, "https://images.unsplash.com/photo-1519014816548-bf5fe059798b?auto=format&fit=crop&w=900&q=85"],
      ["Classic Lash Set", "Lashes", "Set price", 120, "https://images.unsplash.com/photo-1589710751893-f9a6770ad71b?auto=format&fit=crop&w=900&q=85"],
      ["Hybrid Lash Set", "Lashes", "Set price", 120, "https://images.unsplash.com/photo-1522338242992-e1a54906a8da?auto=format&fit=crop&w=900&q=85"],
      ["Eyebrow Wax", "Eyebrows", "Set price", 30, "https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=900&q=85"]
    ];
    starter.forEach(s => insert.run(...s));
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
  if (!req.file) {
    return res.status(400).json({ error: "No image uploaded." });
  }

  const imagePath = "/uploads/" + req.file.filename;
  res.json({ success: true, image: imagePath });
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
  const appts = db.prepare("SELECT * FROM appointments ORDER BY appointment_date DESC, appointment_time DESC, id DESC").all();
  res.json(appts);
});
app.get("/api/booked-times", (req, res) => {
  const date = String(req.query.date || "").trim();

  if (!date) {
    return res.status(400).json({
      error: "Date is required."
    });
  }

  const booked = db.prepare(`
    SELECT appointment_time
    FROM appointments
    WHERE appointment_date = ?
      AND status IN ('pending', 'confirmed')
  `).all(date);

  res.json({
    bookedTimes: booked.map(row => row.appointment_time)
  });
});
app.get("/api/appointment-status", (req, res) => {
  const phone = String(req.query.phone || "").trim();

  if (!phone) {
    return res.status(400).json({ error: "Phone number is required." });
  }

  const cleanPhone = phone.replace(/\D/g, "");

  const appointments = db.prepare(`
    SELECT id, client_name, client_phone, service_name, appointment_date, appointment_time, status
    FROM appointments
    WHERE REPLACE(REPLACE(REPLACE(REPLACE(client_phone, '-', ''), '(', ''), ')', ''), ' ', '') LIKE ?
    ORDER BY appointment_date DESC, appointment_time DESC, id DESC
    LIMIT 5
  `).all(`%${cleanPhone}%`);

  res.json({ appointments });
});

app.post("/api/appointments", async (req, res) => {
  const { client_name, client_phone, client_email, service_id, appointment_date, appointment_time, notes } = req.body; const bookingDate = new Date(appointment_date + "T00:00:00");
const day = bookingDate.getDay();
const bookingDate = new Date(appointment_date + "T00:00:00");
const day = bookingDate.getDay();

if (day === 0 || day === 6) {
  return res.status(400).json({
    error: "PinkSpa is closed on Saturdays and Sundays."
  });
}
if (day === 0 || day === 6) {
  return res.status(400).json({
    error: "PinkSpa is closed on Saturdays and Sundays."
  });
}

  if (!client_name || !client_phone || !service_id || !appointment_date || !appointment_time) {
    return res.status(400).json({ error: "Name, phone, service, date, and time are required." });
  }

  const service = db.prepare("SELECT * FROM services WHERE id = ? AND active = 1").get(service_id);
  if (!service) return res.status(400).json({ error: "Service not found." });

  const existing = db.prepare(`
    SELECT * FROM appointments
    WHERE appointment_date = ?
      AND appointment_time = ?
      AND status IN ('pending', 'confirmed')
  `).get(appointment_date, normalizeTime(appointment_time));

  if (existing) {
    return res.status(409).json({ error: "That time already has an appointment request. Please choose another time." });
  }

  const cleanAppointmentTime = normalizeTime(appointment_time);

  const result = db.prepare(`
    INSERT INTO appointments
    (client_name, client_phone, client_email, service_id, service_name, appointment_date, appointment_time, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    client_name,
    client_phone,
    client_email || "",
    service_id,
    service.name,
    appointment_date,
    cleanAppointmentTime,
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

app.get("/owner", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "owner.html"));
});

app.listen(PORT, () => {
  console.log(`PinkSpa booking system running on port ${PORT}`);
  console.log(`Owner login email: ${OWNER_EMAIL}`);
});
