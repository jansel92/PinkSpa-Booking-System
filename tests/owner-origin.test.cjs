const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const crypto = require("node:crypto");
const { createOwnerOriginValidator } = require("../owner-origin");

const canonical = "https://rachelpinkspa.com";
const foreign = "https://foreign.example";
function validate(headers, { production = true, baseUrl = canonical, port = 3000, rawHeaders = [] } = {}) {
  const result = { status: 200 };
  const res = {
    status(code) { result.status = code; return res; },
    json(body) { result.body = body; return res; }
  };
  result.accepted = createOwnerOriginValidator({ production, baseUrl, port })({ headers, rawHeaders }, res);
  return result;
}
function forbidden(result) {
  assert.equal(result.status, 403);
  assert.deepEqual(result.body, { error: "Forbidden" });
}

test("production accepts exact canonical Origin or parsed Referer fallback", () => {
  assert.equal(validate({ origin: canonical }).accepted, true);
  assert.equal(validate({ origin: canonical, referer: foreign }).accepted, true);
  for (const referer of [`${canonical}/owner`, `${canonical}/owner?tab=services`, `${canonical}/`]) {
    assert.equal(validate({ referer }).accepted, true);
  }
});

test("present invalid Origin cannot fall back to a valid Referer", () => {
  for (const origin of [foreign, "null", "", "undefined", "not a URL", `${canonical}/`,
    `${canonical}:443`, "https://RACHELPINKSPA.COM", `${canonical}, ${foreign}`,
    `${canonical} ${foreign}`, `${canonical}\n`, [canonical], [canonical, canonical],
    "https://www.rachelpinkspa.com", "https://pinkspa-booking-system.onrender.com",
    "http://localhost:3000", "http://rachelpinkspa.com", "https://rachelpinkspa.com.evil.example",
    "https://rachelpinkspa.com@evil.example"]) {
    forbidden(validate({ origin, referer: `${canonical}/owner` }));
  }
});

test("missing, malformed, foreign and repeated fallback headers fail generically", () => {
  for (const referer of [undefined, "", "null", "/owner", foreign, "https://", "https:\\rachelpinkspa.com",
    ` ${canonical}/owner`, `${canonical}/owner ${foreign}`, `https://user@rachelpinkspa.com/owner`,
    [canonical]]) {
    forbidden(validate({ referer, host: "rachelpinkspa.com", "x-forwarded-host": "rachelpinkspa.com" }));
  }
  forbidden(validate({ origin: canonical }, {
    rawHeaders: ["Origin", canonical, "oRiGiN", canonical]
  }));
  forbidden(validate({ referer: `${canonical}/owner` }, {
    rawHeaders: ["Referer", `${canonical}/owner`, "referer", `${canonical}/owner`]
  }));
});

test("production configuration fails closed without trusting a fallback host", () => {
  for (const baseUrl of ["", "not-a-url", "http://rachelpinkspa.com", `${canonical}/path`,
    `${canonical}?query=1`, `${canonical}#hash`, "https://user@rachelpinkspa.com"]) {
    forbidden(validate({ origin: canonical }, { baseUrl }));
  }
  const missing = createOwnerOriginValidator({ production: true, port: 3000 });
  assert.equal(missing({ headers: { origin: canonical } }, { status() { return this; }, json() {} }), false);
  assert.equal(validate({ origin: canonical }, { baseUrl: `${canonical}/` }).accepted, true);
});

test("development allows only exact HTTP loopback origins at the configured port", () => {
  const options = { production: false, port: 3100 };
  for (const origin of ["http://localhost:3100", "http://127.0.0.1:3100", "http://[::1]:3100"]) {
    assert.equal(validate({ origin }, options).accepted, true);
    assert.equal(validate({ referer: `${origin}/owner` }, options).accepted, true);
  }
  for (const origin of [canonical, "http://localhost:3000", "https://localhost:3100",
    "http://localhost.evil.example:3100", "http://127.0.0.2:3100", "http://0.0.0.0:3100"]) {
    forbidden(validate({ origin }, options));
  }
});

// Real Express, session cookies, SQLite and Multer, using disposable local data.
// No production calls or email delivery. Requires the app's existing dependencies.
async function startServer(t, production = true) {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pinkspa-origin-test-"));
  const credentials = { email: "owner@fixture.test", password: crypto.randomBytes(24).toString("hex") };
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env, PORT: String(port), DATA_DIR: dataDir,
      NODE_ENV: production ? "production" : "development", RENDER: production ? "true" : "false",
      APP_BASE_URL: production ? canonical : "",
      RENDER_EXTERNAL_URL: "https://pinkspa-booking-system.onrender.com",
      OWNER_EMAIL: credentials.email, OWNER_PASSWORD: credentials.password,
      SESSION_SECRET: crypto.randomBytes(32).toString("hex"), EMAIL_USER: "", EMAIL_PASS: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Fixture server startup timed out")), 15000);
    let errors = "";
    child.stderr.on("data", data => { errors += data; });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(`Fixture server exited: ${errors}`)); });
    child.stdout.on("data", data => {
      if (String(data).includes("PinkSpa booking system running")) { clearTimeout(timer); resolve(); }
    });
  });
  const fixture = { port, dataDir, credentials, cookie: "", origin: production ? canonical : `http://localhost:${port}` };
  fixture.call = async (method, pathname, { body, headers = {}, sendOrigin = true, sendCookie = true } = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: {
        ...(production ? { "x-forwarded-proto": "https" } : {}),
        ...(sendOrigin ? { Origin: fixture.origin } : {}),
        ...(sendCookie && fixture.cookie ? { Cookie: fixture.cookie } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  fixture.login = async options => {
    const result = await fixture.call("POST", "/api/login", { body: credentials, ...options });
    if (result.status === 200) fixture.cookie = result.headers.get("set-cookie").split(";")[0];
    return result;
  };
  return fixture;
}

test("HTTP: production Owner/auth protection and public endpoint preservation", { timeout: 30000 }, async t => {
  const s = await startServer(t);
  await t.test("login rejects foreign origin, accepts canonical origin and rotates the session", async () => {
    forbidden(await s.login({ headers: { Origin: foreign } }));
    assert.equal((await s.login()).status, 200);
    assert.ok(s.cookie.startsWith("connect.sid="));
    assert.ok((await s.call("GET", "/api/me", { sendOrigin: false })).body.owner);
  });

  // Rejected writes never reach handlers, even with a valid Owner session.
  const mutations = [
    ["PUT", "/api/settings"], ["POST", "/api/upload-service-image"],
    ["POST", "/api/services"], ["PUT", "/api/services/1"], ["DELETE", "/api/services/1"],
    ["PUT", "/api/notifications/1/read"], ["PUT", "/api/notifications/read-all"],
    ["PUT", "/api/appointments/1/status"], ["DELETE", "/api/appointments/1"],
    ["PUT", "/api/admin/reviews/1/approve"], ["PUT", "/api/admin/reviews/1/unapprove"],
    ["DELETE", "/api/admin/reviews/1"], ["POST", "/api/blocked-days"], ["DELETE", "/api/blocked-days/1"]
  ];
  await t.test("all 14 current Owner mutations reject missing and foreign origins", async () => {
    for (const [method, route] of mutations) {
      forbidden(await s.call(method, route, { body: {}, sendOrigin: false }));
      forbidden(await s.call(method, route, { body: {}, headers: { Origin: foreign } }));
    }
    assert.equal((await s.call("PUT", "/api/settings", { body: {}, sendOrigin: false, sendCookie: false })).status, 401);
  });

  await t.test("HTTP rejects null, malformed and repeated Origin headers", async () => {
    for (const Origin of ["null", "", "not-a-url", `${canonical}, ${foreign}`, `${canonical} ${foreign}`]) {
      forbidden(await s.call("PUT", "/api/notifications/read-all", { body: {}, headers: { Origin } }));
    }
    const repeated = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port: s.port,
        path: "/api/notifications/read-all", method: "PUT",
        headers: ["Host", `127.0.0.1:${s.port}`, "Cookie", s.cookie, "Origin", canonical, "oRiGiN", canonical]
      }, res => {
        let body = "";
        res.on("data", data => { body += data; });
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      });
      req.on("error", reject);
      req.end();
    });
    forbidden(repeated);
  });

  let serviceId, appointmentId, reviewId;
  await t.test("settings and service/price mutations work; Referer fallback is accepted", async () => {
    const settings = (await s.call("GET", "/api/settings", { sendOrigin: false })).body;
    assert.equal((await s.call("PUT", "/api/settings", { body: { ...settings, city: "Fixture City" },
      sendOrigin: false, headers: { Referer: `${canonical}/owner` } })).status, 200);
    assert.equal((await s.call("GET", "/api/settings")).body.city, "Fixture City");
    const created = await s.call("POST", "/api/services", { body: {
      name: "Fixture Service", category: "Nails", price: "$50", duration: 30
    } });
    assert.equal(created.status, 200);
    serviceId = created.body.id;
    assert.equal((await s.call("PUT", `/api/services/${serviceId}`, { body: {
      name: "Fixture Service", category: "Nails", price: "$60", duration: 30, active: true
    } })).status, 200);
    assert.equal((await s.call("GET", "/api/services")).body.find(x => x.id === serviceId).price, "$60");
  });

  await t.test("public booking, reviews, availability and status accept absent or foreign origins", async () => {
    for (const [i, headers] of [{}, { Origin: foreign }, { Origin: "null" }].entries()) {
      const created = await s.call("POST", "/api/appointments", { sendOrigin: false, headers, body: {
        client_name: "Fixture Client", client_phone: "7865550101", service_id: serviceId,
        appointment_date: "2099-01-05", appointment_time: ["9:30 AM", "10:00 AM", "10:30 AM"][i], duration_minutes: 30
      } });
      assert.equal(created.status, 200);
      appointmentId = created.body.id;
      const review = await s.call("POST", "/api/reviews", { sendOrigin: false, headers, body: {
        client_name: "Fixture Client", rating: 5, review_text: "Fixture review"
      } });
      assert.equal(review.status, 200);
      reviewId = review.body.id;
      const status = await s.call("GET", "/api/appointment-status?phone=7865550101", { sendOrigin: false, headers });
      assert.equal(status.status, 200);
      assert.equal(status.body.appointments.length, i + 1);
      assert.equal(status.headers.get("cache-control"), "no-store");
      assert.equal((await s.call("GET", "/api/booked-times?date=2099-01-05", { sendOrigin: false, headers })).status, 200);
    }
  });

  await t.test("appointments, CRM reads, review moderation, blocked dates and notifications still work", async () => {
    assert.equal((await s.call("PUT", `/api/appointments/${appointmentId}/status`, { body: { status: "confirmed" } })).status, 200);
    assert.equal((await s.call("GET", "/api/appointments", { sendOrigin: false })).body.find(x => x.id === appointmentId).status, "confirmed");
    assert.equal((await s.call("GET", "/api/clients", { sendOrigin: false })).status, 200);
    assert.equal((await s.call("PUT", `/api/admin/reviews/${reviewId}/approve`)).status, 200);
    assert.ok((await s.call("GET", "/api/reviews", { sendOrigin: false })).body.reviews.some(x => x.id === reviewId));
    assert.equal((await s.call("PUT", `/api/admin/reviews/${reviewId}/unapprove`)).status, 200);
    assert.ok(!(await s.call("GET", "/api/reviews")).body.reviews.some(x => x.id === reviewId));
    assert.equal((await s.call("DELETE", `/api/admin/reviews/${reviewId}`)).status, 200);
    assert.equal((await s.call("POST", "/api/blocked-days", { body: { block_date: "2099-01-06", reason: "Fixture" } })).status, 200);
    const blocked = (await s.call("GET", "/api/blocked-days")).body.find(x => x.block_date === "2099-01-06");
    assert.equal((await s.call("DELETE", `/api/blocked-days/${blocked.id}`)).status, 200);
    const notification = (await s.call("GET", "/api/notifications")).body.notifications[0];
    assert.equal((await s.call("PUT", `/api/notifications/${notification.id}/read`)).status, 200);
    assert.equal((await s.call("PUT", "/api/notifications/read-all")).status, 200);
    assert.equal((await s.call("GET", "/api/notifications")).body.unread_count, 0);
    assert.equal((await s.call("DELETE", `/api/appointments/${appointmentId}`)).status, 200);
    assert.equal((await s.call("DELETE", `/api/services/${serviceId}`)).status, 200);
  });

  await t.test("Owner upload is blocked before Multer; allowed uploads still process", async () => {
    const uploadsDir = path.join(s.dataDir, "service-uploads");
    async function upload(origin, valid = true) {
      const form = new FormData();
      form.append("image", new Blob(["fixture bytes"], { type: valid ? "image/png" : "text/plain" }), "fixture.png");
      const res = await fetch(`http://127.0.0.1:${s.port}/api/upload-service-image`, {
        method: "POST", headers: { Cookie: s.cookie, Origin: origin }, body: form
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }
    forbidden(await upload(foreign));
    forbidden(await upload(foreign, false)); // Multer would otherwise reject the file first.
    assert.deepEqual(fs.readdirSync(uploadsDir), []);
    const allowed = await upload(canonical);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.success, true);
    assert.equal(fs.readdirSync(uploadsDir).length, 1);
  });

  await t.test("logout rejects bad origin without destroying session; Referer fallback logs out", async () => {
    forbidden(await s.call("POST", "/api/logout", { headers: { Origin: "null" } }));
    assert.ok((await s.call("GET", "/api/me", { sendOrigin: false })).body.owner);
    assert.equal((await s.call("POST", "/api/logout", { sendOrigin: false, headers: { Referer: `${canonical}/owner` } })).status, 200);
    assert.equal((await s.call("GET", "/api/appointments", { sendOrigin: false })).status, 401);
    assert.equal((await s.login({ sendOrigin: false, headers: { Referer: `${canonical}/owner` } })).status, 200);
    assert.equal((await s.call("POST", "/api/logout")).status, 200);
    forbidden(await s.call("POST", "/api/logout", { sendOrigin: false }));
  });
});

test("HTTP: development login, mutation and logout remain usable at the local port", { timeout: 20000 }, async t => {
  const s = await startServer(t, false);
  assert.equal((await s.login()).status, 200);
  assert.equal((await s.call("PUT", "/api/notifications/read-all", {
    headers: { Origin: `http://127.0.0.1:${s.port}` }
  })).status, 200);
  forbidden(await s.call("PUT", "/api/notifications/read-all", { headers: { Origin: "http://localhost:1" } }));
  assert.equal((await s.call("POST", "/api/logout", { sendOrigin: false,
    headers: { Referer: `http://localhost:${s.port}/owner` } })).status, 200);
});
