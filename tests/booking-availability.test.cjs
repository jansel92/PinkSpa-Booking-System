const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Run the actual client functions/submit handler with small DOM, transport and
// clock adapters. No server, SQLite, production requests or new packages involved.
// Native browser validation, layout and PWA caching still require manual checks.
const source = fs.readFileSync(path.join(__dirname, "../public/client.js"), "utf8");
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Client section exists: ${start}`);
  return source.slice(from, to);
}
const clientCode = [
  section("const allTimes =", "const serviceCategories ="),
  section("function getSelectedDuration()", "function addRecommendedService("),
  section("function updateBookingSummary(", "function selectServiceForBooking("),
  section('const bookingForm =', 'const statusForm =')
].join("\n");
const failureMessage = "We couldn’t load available times. Please check your connection and refresh the page, or contact PinkSpa on WhatsApp.";

class Element {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.listeners = new Map();
    this.attributes = {};
    this.disabled = false;
    this.checked = false;
    this.rawValue = "";
    this.classList = { toggle() {} };
  }
  set innerHTML(value) { this.children = []; this.selection = undefined; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() {
    return this.children.length
      ? this.children.map(child => typeof child === "string" ? child : child.textContent).join("")
      : this.text || "";
  }
  set value(value) {
    if (this.tag === "select") this.selection = String(value);
    else this.rawValue = String(value);
  }
  get value() {
    return this.tag === "select" ? this.selection ?? this.children[0]?.value ?? "" : this.rawValue;
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
}

function response(data = { blocked: false, availableTimes: ["10:00 AM", "10:30 AM"] }, status = 200) {
  return { ok: status >= 200 && status < 300, json: async () => data };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const fields = Object.fromEntries([
    "client_name", "client_phone", "client_email", "appointment_date", "appointment_time", "notes"
  ].map(name => [name, new Element(name === "appointment_time" ? "select" : "input")]));
  fields.client_name.value = "Booking Fixture";
  fields.client_phone.value = "3055550123";
  fields.client_email.value = "fixture@example.test";
  fields.appointment_date.value = "2030-01-07";
  fields.notes.value = "  Original client note  ";
  const ids = Object.fromEntries([
    "bookingForm", "bookingMessage", "serviceSelect", "bookingSummary", "bookingMiniSummary"
  ].map(id => [id, new Element()]));
  const services = [{ id: 1, name: "Fixture manicure", duration: 60 }];
  const choices = [new Element("input")];
  choices[0].checked = true;
  const calls = [];
  const confirmations = [];
  const overlays = [];
  const timers = new Map();
  let nextTimer = 0;
  let transport = async () => response();
  let recommendations = 0;
  ids.bookingForm.reset = () => {
    Object.values(fields).forEach(field => { field.value = ""; });
    ids.serviceSelect.value = "";
  };
  class FixtureFile {}
  class FixtureFormData extends Map {
    constructor() {
      super(Object.entries(fields).filter(([, field]) => !field.disabled).map(([name, field]) => [name, field.value]));
      this.set("service_id", ids.serviceSelect.value);
    }
  }
  const context = vm.createContext({
    document: {
      getElementById: id => ids[id] || null,
      querySelector: selector => fields[selector.match(/name="([^"]+)"/)?.[1]] || null,
      querySelectorAll: selector => selector === ".service-choice" ? choices : [],
      createElement: tag => new Element(tag)
    },
    getSelectedServices: () => services.filter((_, index) => choices[index]?.checked),
    getPrimaryService: selected => (selected || services)[0] || null,
    renderServiceRecommendations() { recommendations++; },
    syncServiceChoiceCard() {},
    setAppLoading: value => overlays.push(value),
    bookingConfirmation: { open: details => confirmations.push(details) },
    URLSearchParams, AbortController, FormData: FixtureFormData, File: FixtureFile,
    fetch(url, options) { calls.push({ url, options }); return transport(url, options); },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    console: { error() {} }
  });
  vm.runInContext(clientCode, context);
  return {
    fields, ids, services, choices, calls, confirmations, overlays, timers,
    transport: fn => { transport = fn; },
    update: () => context.updateAvailableTimes(),
    setup: () => context.setupBookingDateRules(),
    summary: options => context.updateBookingSummary(options),
    verified: () => context.hasVerifiedAvailability(),
    state: () => vm.runInContext("availabilityState", context),
    recommendations: () => recommendations,
    submit: () => ids.bookingForm.listeners.get("submit")({ preventDefault() {}, target: ids.bookingForm })
  };
}
function assertUnavailable(h) {
  assert.equal(h.fields.appointment_time.disabled, true);
  assert.equal(h.fields.appointment_time.value, "");
  assert.equal(h.fields.appointment_time.textContent, "Availability unavailable");
  assert.equal(h.ids.bookingMessage.textContent, failureMessage);
  assert.equal(h.verified(), false);
  assert.equal(h.timers.size, 0);
}

test("initial pre-date control is empty, disabled and announced accessibly", async () => {
  const h = harness();
  h.fields.appointment_date.value = "";
  h.setup();
  assert.equal(h.fields.appointment_time.disabled, true);
  assert.equal(h.fields.appointment_time.value, "");
  assert.equal(h.fields.appointment_time.textContent, "Choose a date to see available times.");
  assert.equal(h.ids.bookingMessage.attributes.role, "status");
  assert.equal(h.calls.length, 0);
  await h.submit();
  assert.equal(h.calls.length, 0);
});

test("populated success renders only server times and sends combined duration", async () => {
  const h = harness();
  h.services.push({ id: 2, name: "Fixture add-on", duration: 30 });
  h.choices.push(Object.assign(new Element("input"), { checked: true }));
  await h.update();
  assert.equal(h.fields.appointment_time.disabled, false);
  assert.deepEqual(h.fields.appointment_time.children.map(option => option.value), ["10:00 AM", "10:30 AM"]);
  assert.equal(h.fields.appointment_time.value, "10:00 AM");
  assert.equal(h.verified(), true);
  assert.match(h.calls[0].url, /date=2030-01-07&duration_minutes=90$/);
  assert.equal(h.timers.size, 0);
});

test("empty success preserves no-times behavior and prevents submission", async () => {
  const h = harness();
  h.transport(async () => response({ blocked: false, availableTimes: [] }));
  await h.update();
  const message = h.ids.bookingMessage.textContent;
  assert.equal(h.fields.appointment_time.disabled, true);
  assert.equal(h.fields.appointment_time.textContent, "No times available");
  assert.match(message, /No times are available/);
  await h.submit();
  assert.equal(h.calls.length, 1);
  assert.equal(h.ids.bookingMessage.textContent, message);
});

for (const reason of ["Holiday", ""]) {
  test(`blocked date preserves explanation (${reason || "no reason"})`, async () => {
    const h = harness();
    h.transport(async () => response({ blocked: true, reason, bookedTimes: [], bookedAppointments: [] }));
    await h.update();
    assert.equal(h.fields.appointment_time.disabled, true);
    assert.match(h.ids.bookingMessage.textContent, /This date is unavailable/);
    assert.equal(h.verified(), false);
    const message = h.ids.bookingMessage.textContent;
    await h.submit();
    assert.equal(h.calls.length, 1);
    assert.equal(h.ids.bookingMessage.textContent, message);
  });
}

test("weekend remains closed without making a request", async () => {
  const h = harness();
  h.fields.appointment_date.value = "2030-01-05";
  await h.update();
  assert.equal(h.fields.appointment_time.disabled, true);
  assert.match(h.ids.bookingMessage.textContent, /closed on Saturdays and Sundays/);
  assert.equal(h.calls.length, 0);
  await h.submit();
  assert.equal(h.calls.length, 0);
});

for (const status of [400, 403, 404, 429, 500, 503]) {
  test(`HTTP ${status} fails closed without losing customer details`, async () => {
    const h = harness();
    await h.update();
    h.transport(async () => response({ error: "Fixture failure" }, status));
    await h.update();
    assertUnavailable(h);
    assert.equal(h.fields.client_name.value, "Booking Fixture");
    assert.equal(h.fields.client_phone.value, "3055550123");
    assert.equal(h.fields.notes.value, "  Original client note  ");
    assert.equal(h.choices[0].checked, true);
  });
}

test("network failure fails closed", async () => {
  const h = harness();
  h.transport(async () => { throw new TypeError("Network unavailable"); });
  await h.update();
  assertUnavailable(h);
});

for (const body of ["not JSON", "<html>Gateway error</html>", ""]) {
  test(`invalid JSON response fails closed: ${JSON.stringify(body)}`, async () => {
    const h = harness();
    h.transport(async () => ({ ok: true, json: async () => JSON.parse(body) }));
    await h.update();
    assertUnavailable(h);
  });
}

for (const [name, data] of [
  ["null", null], ["array", []], ["string", "unexpected"], ["empty object", {}],
  ["missing blocked", { availableTimes: ["10:00 AM"] }],
  ["nonboolean blocked", { blocked: "false", availableTimes: ["10:00 AM"] }],
  ["missing availableTimes", { blocked: false, bookedTimes: [] }],
  ["null availableTimes", { blocked: false, availableTimes: null }],
  ["string availableTimes", { blocked: false, availableTimes: "10:00 AM" }],
  ["malformed reason", { blocked: true, reason: {} }],
  ["unknown time", { blocked: false, availableTimes: ["3:00 AM"] }],
  ["blank time", { blocked: false, availableTimes: [""] }],
  ["number entry", { blocked: false, availableTimes: [1000] }],
  ["null entry", { blocked: false, availableTimes: [null] }],
  ["object entry", { blocked: false, availableTimes: [{}] }],
  ["duplicate times", { blocked: false, availableTimes: ["10:00 AM", "10:00 AM"] }]
]) {
  test(`malformed availability fails closed: ${name}`, async () => {
    const h = harness();
    h.transport(async () => response(data));
    await h.update();
    assertUnavailable(h);
  });
}

test("timeout aborts a pending fetch after the configured 15 seconds", async () => {
  const h = harness();
  h.transport((url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
  }));
  const pending = h.update();
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 15000);
  timer.callback();
  await pending;
  assert.equal(h.calls[0].options.signal.aborted, true);
  assertUnavailable(h);
});

test("timeout also covers a pending response body", async () => {
  const h = harness();
  const body = deferred();
  h.transport(async (url, { signal }) => {
    signal.addEventListener("abort", () => body.reject(new Error("Body aborted")), { once: true });
    return { ok: true, json: () => body.promise };
  });
  const pending = h.update();
  await Promise.resolve();
  [...h.timers.values()][0].callback();
  await pending;
  assertUnavailable(h);
});

test("replacement request immediately clears prior slots and verification", async () => {
  const h = harness();
  await h.update();
  h.fields.appointment_time.value = "10:30 AM";
  h.fields.appointment_date.value = "2030-01-08";
  const next = deferred();
  h.transport(() => next.promise);
  const pending = h.update();
  assert.equal(h.fields.appointment_time.disabled, true);
  assert.equal(h.fields.appointment_time.value, "");
  assert.equal(h.fields.appointment_time.textContent, "Checking availability…");
  assert.equal(h.verified(), false);
  await h.submit();
  assert.equal(h.calls.length, 2);
  assert.match(h.ids.bookingMessage.textContent, /Please wait/);
  next.resolve(response());
  await pending;
});

for (const oldOutcome of ["success", "failure"]) {
  test(`older ${oldOutcome} cannot overwrite newer verification`, async () => {
    const h = harness();
    const older = deferred();
    h.transport(() => older.promise);
    const pending = h.update();
    h.fields.appointment_date.value = "2030-01-08";
    h.transport(async () => response({ blocked: false, availableTimes: ["11:00 AM"] }));
    await h.update();
    if (oldOutcome === "success") older.resolve(response());
    else older.reject(new Error("Old request failed"));
    await pending;
    assert.equal(h.fields.appointment_time.value, "11:00 AM");
    assert.equal(h.state().date, "2030-01-08");
    assert.equal(h.verified(), true);
    assert.equal(h.ids.bookingMessage.textContent, "");
    assert.equal(h.timers.size, 0);
  });
}

test("older success cannot reopen slots after newer failure", async () => {
  const h = harness();
  const older = deferred();
  h.transport(() => older.promise);
  const pending = h.update();
  h.transport(async () => response({}, 503));
  await h.update();
  older.resolve(response());
  await pending;
  assertUnavailable(h);
});

test("clearing date invalidates an in-flight success", async () => {
  const h = harness();
  const older = deferred();
  h.transport(() => older.promise);
  const pending = h.update();
  h.fields.appointment_date.value = "";
  await h.update();
  older.resolve(response());
  await pending;
  assert.equal(h.fields.appointment_time.disabled, true);
  assert.equal(h.fields.appointment_time.textContent, "Choose a date to see available times.");
  assert.equal(h.verified(), false);
});

test("submission after failure stays blocked even with a forged dropdown value", async () => {
  const h = harness();
  h.transport(async () => response({}, 503));
  await h.update();
  h.fields.appointment_time.disabled = false;
  h.fields.appointment_time.value = "10:00 AM";
  await h.submit();
  assert.equal(h.calls.length, 1);
  assert.equal(h.ids.bookingMessage.textContent, failureMessage);
});

for (const mismatch of ["date", "duration", "time"]) {
  test(`submission rejects verification mismatch: ${mismatch}`, async () => {
    const h = harness();
    await h.update();
    if (mismatch === "date") h.fields.appointment_date.value = "2030-01-08";
    if (mismatch === "duration") h.services[0].duration = 90;
    if (mismatch === "time") h.fields.appointment_time.value = "2:30 PM";
    await h.submit();
    assert.equal(h.calls.length, 1);
    assert.equal(h.verified(), false);
  });
}

test("failure can recover into verified slots", async () => {
  const h = harness();
  h.transport(async () => response({}, 500));
  await h.update();
  h.transport(async () => response());
  await h.update();
  assert.equal(h.verified(), true);
  assert.equal(h.fields.appointment_time.disabled, false);
  assert.equal(h.ids.bookingMessage.textContent, "");
});

test("verified submission preserves selected time, combined payload and confirmation/reset", async () => {
  const h = harness();
  h.services.push({ id: 2, name: "Fixture add-on", duration: 30 });
  h.choices.push(Object.assign(new Element("input"), { checked: true }));
  await h.update();
  h.fields.appointment_time.value = "10:30 AM";
  const recommendationsBefore = h.recommendations();
  let payload;
  h.transport(async (url, options) => {
    assert.equal(url, "/api/appointments", "No redundant availability fetch during submit");
    assert.equal(options.method, "POST");
    payload = Object.fromEntries(options.body.entries());
    assert.equal(h.fields.appointment_time.value, "10:30 AM");
    assert.equal(h.fields.appointment_time.disabled, false);
    return response({ success: true });
  });
  await h.submit();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(payload, {
    client_name: "Booking Fixture", client_phone: "3055550123", client_email: "fixture@example.test",
    appointment_date: "2030-01-07", appointment_time: "10:30 AM", service_id: "1",
    selected_service_ids: "1,2", duration_minutes: "90", client_notes: "Original client note",
    notes: "\nSelected Services: Fixture manicure (60 min), Fixture add-on (30 min)\nTotal Estimated Time: 90 minutes\n\nClient Notes:\n  Original client note  \n"
  });
  assert.equal(h.recommendations(), recommendationsBefore + 2, "Summary behavior runs on submit and reset");
  assert.equal(h.confirmations.length, 1);
  assert.equal(h.confirmations[0].time, "10:30 AM");
  assert.equal(h.confirmations[0].duration, "90 minutes");
  assert.deepEqual(h.overlays, [true, false]);
  assert.equal(h.fields.appointment_date.value, "");
  assert.equal(h.fields.appointment_time.disabled, true);
  assert.equal(h.fields.appointment_time.textContent, "Choose a date to see available times.");
  assert.equal(h.verified(), false);
  assert.ok(h.choices.every(choice => !choice.checked));
  assert.match(h.ids.bookingMessage.textContent, /appointment request was sent/);
});

for (const refreshFails of [false, true]) {
  test(`appointment rejection refreshes availability (refresh fails: ${refreshFails})`, async () => {
    const h = harness();
    await h.update();
    h.transport(async url => url === "/api/appointments"
      ? response({ error: "This time is no longer available." }, 409)
      : refreshFails ? response({}, 503) : response({ blocked: false, availableTimes: ["11:00 AM"] }));
    await h.submit();
    assert.equal(h.calls.length, 3);
    assert.match(h.ids.bookingMessage.textContent, /This time is no longer available/);
    assert.equal(h.fields.client_name.value, "Booking Fixture");
    assert.equal(h.choices[0].checked, true);
    assert.equal(h.confirmations.length, 0);
    if (refreshFails) {
      assert.ok(h.ids.bookingMessage.textContent.includes(failureMessage));
      assert.equal(h.fields.appointment_time.disabled, true);
      assert.equal(h.fields.appointment_time.textContent, "Availability unavailable");
      assert.equal(h.verified(), false);
    } else {
      assert.equal(h.fields.appointment_time.value, "11:00 AM");
      assert.equal(h.verified(), true);
    }
  });
}

test("rejection recovery does not overwrite a newer request's failure message", async () => {
  const h = harness();
  await h.update();
  const oldRefresh = deferred();
  h.transport(async url => url === "/api/appointments" ? response({ error: "Rejected" }, 409) : oldRefresh.promise);
  const submitted = h.submit();
  for (let i = 0; i < 8 && h.calls.length < 3; i++) await Promise.resolve();
  assert.equal(h.calls.length, 3);
  h.fields.appointment_date.value = "2030-01-08";
  h.transport(async () => response({}, 503));
  await h.update();
  oldRefresh.resolve(response());
  await submitted;
  assertUnavailable(h);
});
