const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

// Execute the actual auth code without starting the app, opening SQLite, or
// installing packages. Session/store and bcrypt adapters are test doubles;
// transport-level express-session behavior still needs integration verification.
const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, "Authentication source section must exist");
  return source.slice(from, to);
}
const authCode = [
  section("const PORT =", "const NOTIFY_EMAIL ="),
  section("const OWNER_SESSION_COOKIE =", "// Service images"),
  section("function hasValidOwnerSession(", "function normalizeTime("),
  section('app.post("/api/login",', 'app.get("/review",')
].join("\n");
const lifetime = 12 * 60 * 60 * 1000;
function fixtureEnvironment() {
  return {
    OWNER_EMAIL: "fixture@example.test",
    OWNER_PASSWORD: crypto.randomBytes(24).toString("hex"),
    SESSION_SECRET: crypto.randomBytes(32).toString("hex")
  };
}
function harness(env = {}, failures = {}) {
  const credentials = fixtureEnvironment();
  const owner = { id: 1, email: credentials.OWNER_EMAIL, password_hash: "fixture-only" };
  const routes = new Map();
  const sessions = new Map();
  const clock = { now: 2000000000000 };
  const calls = { comparisons: 0, regenerated: 0, saved: 0, destroyed: 0 };
  let config;
  class Clock extends Date { static now() { return clock.now; } }
  const context = vm.createContext({
    process: { env }, Date: Clock,
    app: {
      use() {},
      get(route, handler) { routes.set(`GET ${route}`, handler); },
      post(route, handler) { routes.set(`POST ${route}`, handler); }
    },
    session(options) { config = options; },
    db: { prepare() { return { get(email) { return email === owner.email ? owner : undefined; } }; } },
    bcrypt: { compareSync(password, hash) {
      calls.comparisons++;
      return password === credentials.OWNER_PASSWORD && hash === owner.password_hash;
    } }
  });
  vm.runInContext(authCode, context);
  function attach(req, id) {
    req.sessionID = id;
    const data = sessions.has(id) ? structuredClone(sessions.get(id)) : {};
    req.session = data;
    Object.defineProperties(data, {
      regenerate: { value(callback) {
        calls.regenerated++;
        if (failures.regenerate) return queueMicrotask(() => callback(new Error("Fixture failure")));
        sessions.delete(id);
        attach(req, crypto.randomBytes(24).toString("hex"));
        queueMicrotask(() => callback());
      } },
      save: { value(callback) {
        calls.saved++;
        if (failures.save) return queueMicrotask(() => callback(new Error("Fixture failure")));
        sessions.set(id, structuredClone(data));
        queueMicrotask(() => callback());
      } },
      destroy: { value(callback) {
        calls.destroyed++;
        delete req.session;
        if (!failures.destroy) sessions.delete(id);
        queueMicrotask(() => callback(failures.destroy ? new Error("Fixture failure") : undefined));
      } }
    });
  }
  function request(route, body, id = crypto.randomBytes(24).toString("hex")) {
    const req = { body };
    attach(req, id);
    return new Promise(resolve => {
      const result = { status: 200, cleared: [], req };
      const res = {
        status(code) { result.status = code; return res; },
        clearCookie(name, options) { result.cleared.push({ name, options: { ...options } }); return res; },
        json(data) { result.body = JSON.parse(JSON.stringify(data)); resolve(result); return res; }
      };
      if (route === "protected") context.requireOwner(req, res, () => res.json({ authorized: true }));
      else routes.get(route)(req, res);
    });
  }
  const login = id => request("POST /api/login", {
    email: owner.email, password: credentials.OWNER_PASSWORD
  }, id);
  return { config, context, sessions, calls, clock, request, login };
}

test("local cookie attributes preserve HTTP development and cookie identity", () => {
  const h = harness();
  assert.equal(h.config.name, "connect.sid");
  assert.deepEqual({ ...h.config.cookie }, {
    httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: lifetime
  });
  assert.equal(h.config.proxy, false);
  assert.equal(h.config.rolling, false);
  assert.equal(h.config.resave, false);
  assert.equal(h.config.saveUninitialized, false);
  assert.equal(h.config.store, undefined, "No replacement store introduced");
});

test("production and Render enable Secure and session-scoped proxy handling", () => {
  for (const deployment of [{ NODE_ENV: "production" }, { RENDER: "true" }]) {
    const h = harness({ ...fixtureEnvironment(), ...deployment });
    assert.equal(h.config.cookie.secure, true);
    assert.equal(h.config.proxy, true);
  }
  assert.ok(!source.includes('app.set("trust proxy"'), "Public endpoint IP semantics unchanged");
});

test("production rejects missing/blank auth settings and development secret defaults", () => {
  const defaults = vm.runInContext("DEVELOPMENT_AUTH", harness().context);
  for (const flag of [{ NODE_ENV: "production" }, { RENDER: "true" }]) {
    for (const name of ["OWNER_EMAIL", "OWNER_PASSWORD", "SESSION_SECRET"]) {
      for (const value of [undefined, "   "]) {
        const env = { ...fixtureEnvironment(), ...flag, [name]: value };
        assert.throws(() => harness(env), e => e.message.includes(name), "Fail safely without disclosing values");
      }
    }
    for (const name of ["OWNER_PASSWORD", "SESSION_SECRET"]) {
      const env = { ...fixtureEnvironment(), ...flag, [name]: defaults[name] };
      assert.throws(() => harness(env), e => e.message.includes(name));
    }
    // An explicitly configured username may remain unchanged; it is not a secret.
    assert.doesNotThrow(() => harness({ ...fixtureEnvironment(), ...flag, OWNER_EMAIL: defaults.OWNER_EMAIL }));
  }
  assert.ok(source.indexOf("if (IS_PRODUCTION)") < source.indexOf("fs.mkdirSync"), "Validation precedes database/filesystem initialization");
});

test("invalid credentials retain the generic failure and do not create owner state", async () => {
  const h = harness();
  for (const body of [undefined, {}, { email: [], password: {} },
    { email: "unknown@example.test", password: "invalid" },
    { email: "fixture@example.test", password: "invalid" }]) {
    const r = await h.request("POST /api/login", body);
    assert.equal(r.status, 401);
    assert.deepEqual(r.body, { error: "Invalid login." });
    assert.ok(!r.req.session.owner);
  }
  assert.equal(h.calls.regenerated, 0);
  assert.equal(h.sessions.size, 0);
});

test("login rotates before authenticating, saves before success, and rejects old/anonymous sessions", async () => {
  const h = harness();
  const oldId = crypto.randomBytes(24).toString("hex");
  h.sessions.set(oldId, { fixture: true });
  assert.equal((await h.request("protected")).status, 401);
  const r = await h.login(oldId);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true });
  assert.ok(r.req.sessionID !== oldId, "Session identity rotates");
  assert.ok(!h.sessions.has(oldId), "Old identity invalidated");
  assert.equal(h.calls.regenerated, 1);
  assert.equal(h.calls.saved, 1);
  assert.ok(h.sessions.has(r.req.sessionID), "Authenticated session saved before response");
  assert.equal((await h.request("protected", undefined, r.req.sessionID)).status, 200);
  assert.ok((await h.request("GET /api/me", undefined, r.req.sessionID)).body.owner);
  assert.equal((await h.request("protected", undefined, oldId)).status, 401);
});

test("absolute 12-hour expiry is not extended by polling and expires at the boundary", async () => {
  const h = harness();
  const r = await h.login();
  const id = r.req.sessionID;
  const deadline = h.sessions.get(id).ownerExpiresAt;
  assert.equal(deadline - h.clock.now, lifetime);
  h.clock.now = deadline - 1;
  assert.equal((await h.request("protected", undefined, id)).status, 200);
  assert.ok((await h.request("GET /api/me", undefined, id)).body.owner);
  assert.equal(h.sessions.get(id).ownerExpiresAt, deadline);
  h.clock.now = deadline;
  const expired = await h.request("protected", undefined, id);
  assert.equal(expired.status, 401);
  assert.ok(!h.sessions.has(id));
  assert.equal(expired.cleared.length, 1);
  assert.deepEqual((await h.request("GET /api/me", undefined, id)).body, { owner: null });
});

test("me also destroys expired or legacy owner sessions with no deadline", async () => {
  for (const expiresAt of [undefined, 1]) {
    const h = harness();
    const r = await h.login();
    const id = r.req.sessionID;
    h.sessions.get(id).ownerExpiresAt = expiresAt;
    assert.deepEqual((await h.request("GET /api/me", undefined, id)).body, { owner: null });
    assert.ok(!h.sessions.has(id));
    assert.equal((await h.request("protected", undefined, id)).status, 401);
  }
});

test("logout destroys authentication and clears matching cookie attributes in both environments", async () => {
  for (const env of [{}, { ...fixtureEnvironment(), NODE_ENV: "production" }]) {
    const h = harness(env);
    const r = await h.login();
    const id = r.req.sessionID;
    const logout = await h.request("POST /api/logout", undefined, id);
    assert.equal(logout.status, 200);
    assert.ok(!h.sessions.has(id));
    const cookie = logout.cleared[0];
    assert.equal(cookie.name, h.config.name);
    const { maxAge, ...matchingAttributes } = h.config.cookie;
    assert.deepEqual(cookie.options, matchingAttributes);
    assert.ok(!("maxAge" in cookie.options));
    assert.equal((await h.request("protected", undefined, id)).status, 401);
    assert.deepEqual((await h.request("GET /api/me", undefined, id)).body, { owner: null });
    assert.equal((await h.request("POST /api/logout")).status, 200);
  }
});

test("regeneration/save/logout errors never report false success", async () => {
  for (const failure of ["regenerate", "save"]) {
    const h = harness({}, { [failure]: true });
    const r = await h.login();
    assert.equal(r.status, 500);
    assert.ok(!r.body.success);
    assert.equal((await h.request("protected", undefined, r.req.sessionID)).status, 401);
  }
  const h = harness({}, { destroy: true });
  const login = await h.login();
  const r = await h.request("POST /api/logout", undefined, login.req.sessionID);
  assert.equal(r.status, 500);
  assert.ok(!r.body.success);
  assert.equal(r.cleared.length, 1);
});
