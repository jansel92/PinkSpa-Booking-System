# PinkSpa Booking System Roadmap

## Purpose

This roadmap turns the current PinkSpa Booking System into a secure, reliable, revenue-supporting platform without losing the simplicity of the existing client and owner experience.

Priorities are grouped by delivery horizon:

- **Now:** Protect customer data and make the current system production-ready.
- **Next:** Improve scheduling operations, communication, accessibility, and maintainability.
- **Later:** Add revenue features and prepare the architecture for growth.
- **Future:** Expand PinkSpa into a broader multi-provider beauty platform.

## Current Product Baseline

### Completed Client Features

- Premium branded homepage for nails, pedicures, lashes, and brows.
- Responsive service, gallery, review, status, booking, and contact sections.
- Dynamic service catalog loaded from the database.
- Multi-service selection with combined estimated duration.
- Duration-aware appointment availability.
- Prevention of overlaps with pending and confirmed appointments.
- Weekend, blocked-date, and business-closing validation.
- Appointment status lookup.
- Optional inspiration photo upload for JPEG, PNG, and WebP files up to 5 MB.
- Private storage and owner-authenticated access for inspiration photos.
- Clear client-side errors for booking, status, review, service, and settings failures.
- Gallery lightbox, subtle animations, reduced-motion support, and mobile booking actions.
- Basic installable PWA manifest and service worker.

### Completed Owner Features

- Password-protected owner dashboard.
- Appointment list and summary statistics.
- Pending, confirmed, cancelled, completed, and no-show appointment states.
- Inspiration photo preview inside appointment cards.
- Service creation, editing, soft removal, pricing, duration, and image upload.
- Business settings management.
- Full-day availability blocking.
- Review moderation and review-request link copying.
- Optional email notification when a booking is created.

### Completed Platform Features

- Express API with SQLite persistence.
- Parameterized SQL queries.
- Password hashing with bcrypt.
- Session-based owner authentication.
- Additive startup migrations for appointment duration and inspiration images.
- Private inspiration image storage with randomized filenames and file-signature checks.
- Cleanup of inspiration images when appointments are deleted or inserts fail.

---

## Now: Production Safety and Reliability

**Target horizon:** 0-4 weeks  
**Primary outcome:** Customer data is protected and the existing booking workflow can operate safely in production.

### Security and Privacy

- [ ] **Eliminate stored cross-site scripting risks.** Replace unescaped `innerHTML` rendering for appointments, reviews, services, settings, and notes with safe DOM construction or escaping.
  - Why: Public booking and review input is currently rendered in the owner dashboard and could execute malicious markup in an authenticated session.
- [ ] **Enable a restrictive Content Security Policy.** Remove the current CSP opt-out and explicitly permit only required scripts, images, fonts, and connections.
  - Why: CSP provides defense in depth if unsafe content reaches the page.
- [ ] **Secure appointment status lookup.** Require an exact normalized phone number plus a private booking reference or one-time verification code.
  - Why: Partial phone matching can expose other clients' names and appointment details.
- [ ] **Remove production fallback credentials and secrets.** Require `OWNER_EMAIL`, a secure password initialization flow, and `SESSION_SECRET` in production.
  - Why: Known default credentials and predictable secrets can lead to immediate account compromise.
- [ ] **Add authentication rate limiting and lockout controls.** Rate-limit login attempts and alert on repeated failures.
- [ ] **Harden sessions.** Use a persistent session store, regenerate sessions after login, set secure cookies, define expiration, and configure trusted proxies for HTTPS deployments.
- [ ] **Add CSRF protection to owner mutations.** Cover settings, services, appointments, reviews, blocked dates, uploads, and logout.
- [ ] **Add public endpoint abuse controls.** Rate-limit booking, review submission, availability, and status endpoints; add bot protection where needed.
- [ ] **Define customer-data retention rules.** Document when completed appointments, contact details, notes, and inspiration photos are deleted.

### Booking and Data Integrity

- [ ] **Calculate booking duration exclusively on the server.** Submit selected service IDs and derive names, prices, and total duration from active database records.
  - Why: Client-provided duration can be manipulated and cause under-reserved appointments.
- [ ] **Validate all booking fields server-side.** Enforce date format, future dates, business opening time, slot increments, email/phone format, field lengths, and a maximum booking horizon.
- [ ] **Add database constraints and indexes.** Enable SQLite foreign keys and add checks for status, rating, duration, and boolean fields plus indexes for appointment date/status/phone and review approval/date.
- [ ] **Make booking creation atomic.** Wrap final availability validation and appointment insertion in a transaction.
  - Why: This prevents double-booking when simultaneous requests arrive.
- [ ] **Add a proper migration system.** Replace ad hoc startup column checks with versioned, repeatable migrations and rollback guidance.

### Operational Readiness

- [ ] **Add centralized error handling and structured logging.** Return consistent JSON errors, attach request IDs, and avoid exposing internal details.
- [ ] **Add health and readiness endpoints.** Verify application, database, writable storage, and email configuration.
- [ ] **Create automated backups.** Back up SQLite and private uploads, encrypt backups, and test restoration.
- [ ] **Add process supervision and graceful shutdown.** Close database resources and finish active requests during deployment or restart.
- [ ] **Document production deployment.** Include HTTPS, persistent disk requirements, environment variables, backup location, and rollback steps.

### Testing and Delivery

- [ ] **Commit a dependency lockfile and define a supported Node version.**
- [ ] **Add core automated tests.** Prioritize availability boundaries, overlap detection, blocked dates, image validation, authentication, status privacy, and booking creation.
- [ ] **Add end-to-end booking tests.** Cover booking with and without an inspiration photo and owner review of the resulting appointment.
- [ ] **Add CI checks.** Run tests, linting, formatting, dependency audit, and migration verification on every pull request.

### Now Exit Criteria

- No known critical XSS or appointment-data exposure.
- Production refuses to start with default credentials or missing secrets.
- Concurrent booking tests cannot create overlapping appointments.
- Backup restoration and the complete booking-to-owner workflow are verified.

---

## Next: Better Operations and Client Experience

**Target horizon:** 1-3 months  
**Primary outcome:** PinkSpa spends less time coordinating appointments manually and clients receive dependable communication.

### Scheduling Improvements

- [ ] **Create structured business-hours configuration.** Store opening, closing, slot interval, timezone, and working days instead of a display-only hours string.
- [ ] **Support partial-day blocks.** Use the existing blocked-time concept for lunch, personal appointments, and custom unavailable periods.
- [ ] **Model multi-service bookings properly.** Add an `appointment_services` relationship rather than storing secondary services in notes.
- [ ] **Show duration-aware availability entirely from server-calculated service selections.** Keep the client as a renderer rather than a source of scheduling truth.
- [ ] **Add rescheduling.** Let the owner move an appointment while reusing the same conflict validation.
- [ ] **Add configurable buffers.** Support cleanup or preparation time before and after selected services.
- [ ] **Add owner filters and search.** Filter appointments by date, status, client, and service.
- [ ] **Paginate appointments and reviews.** Avoid loading and rendering the full history at once.

### Client Communication

- [ ] **Send booking-received emails or texts to clients.** Include appointment summary and a private reference number.
- [ ] **Notify clients when status changes.** Send confirmation, cancellation, reschedule, and completion messages.
- [ ] **Add reminder automation.** Send reminders 24 hours and 2 hours before confirmed appointments.
- [ ] **Create reusable notification templates.** Keep business name, contact details, policies, and tone configurable.
- [ ] **Track notification delivery.** Record queued, sent, delivered, and failed states.

### Accessibility and Mobile Quality

- [ ] **Complete a WCAG 2.2 AA audit.** Test keyboard access, screen readers, contrast, zoom, touch targets, and reduced motion.
- [ ] **Make the gallery fully keyboard accessible.** Use buttons for thumbnails, trap focus in the lightbox, and restore focus on close.
- [ ] **Add live-region semantics to booking and status messages.**
- [ ] **Add ARIA tab behavior to the owner dashboard.**
- [ ] **Correct form semantics.** Remove nested labels, add autocomplete and input modes, and expose file requirements programmatically.
- [ ] **Fix tablet CTA behavior.** Ensure booking and status actions remain visible between mobile and desktop breakpoints.

### Technical Debt Reduction

- [ ] **Split `server.js` by responsibility.** Separate configuration, database access, migrations, middleware, services, and routes.
- [ ] **Extract shared client helpers.** Consolidate API handling, service-image selection, status labels, time utilities, and safe rendering.
- [ ] **Consolidate the stylesheet.** Remove duplicate hero, service-card, animation, and mobile-action rules plus unnecessary `!important` declarations.
- [ ] **Remove inline event handlers and styles.** Use delegated listeners and reusable classes.
- [ ] **Remove unused dependencies and assets.** Review `cookie-parser`, empty files, duplicate photos, and malformed nested asset paths.

### Performance

- [ ] **Create responsive image variants.** Convert gallery, hero, logo, favicon, and service images to appropriately sized AVIF/WebP assets.
- [ ] **Use native lazy loading for service images.** Replace CSS background images with semantic responsive images where practical.
- [ ] **Reduce initial asset weight.** Target an initial mobile transfer below 1.5 MB and avoid using the 1+ MB source logo for small icons.
- [ ] **Optimize font loading.** Self-host only needed weights or use a system-font fallback strategy.
- [ ] **Improve caching.** Add hashed asset versions, immutable cache headers, and a service-worker strategy that safely updates cached resources.

### Next Exit Criteria

- Business hours and blocks are the single source of scheduling truth.
- Clients receive reliable confirmations and reminders.
- Owner appointment lists remain fast with production-scale data.
- Core client and owner workflows meet WCAG 2.2 AA checks.

---

## Later: Revenue and Growth

**Target horizon:** 3-6 months  
**Primary outcome:** The booking system directly increases conversion, reduces no-shows, and creates repeat business.

### Payments and Policies

- [ ] **Add Stripe deposits.** Support fixed or percentage deposits by service.
- [ ] **Add cancellation and no-show policies.** Present terms before payment and record client acceptance.
- [ ] **Support refunds and owner-approved deposit transfers.**
- [ ] **Add receipts and payment reconciliation.**
- [ ] **Track service price snapshots.** Preserve the booked price even when the catalog changes later.

### Business Opportunities

- [ ] **Add waitlists.** Notify interested clients when cancelled slots reopen.
- [ ] **Add rebooking prompts.** Suggest the next manicure, refill, lash, or brow appointment based on service cadence.
- [ ] **Introduce packages and memberships.** Examples include monthly manicure plans, lash refill bundles, and VIP priority booking.
- [ ] **Sell gift cards.** Support digital delivery, redemption balances, and expiration rules where legally permitted.
- [ ] **Add referral rewards.** Track referral codes and reward both clients after a completed appointment.
- [ ] **Add promotional campaigns.** Offer first-visit, birthday, seasonal, and quiet-period promotions.
- [ ] **Add optional service add-ons.** Allow nail art, removal, repairs, upgrades, or aftercare products during booking.

### Client Relationship Features

- [ ] **Create optional client accounts.** Provide appointment history, saved contact details, inspiration photos, and rebooking.
- [ ] **Add secure magic-link authentication.** Avoid requiring clients to manage another password.
- [ ] **Capture preferences and consent.** Record preferred styles, communication channel, and marketing consent.
- [ ] **Add a client-facing cancellation/reschedule link.** Protect it with a signed, expiring token.

### Analytics and Decision Support

- [ ] **Build an owner analytics dashboard.** Track booking conversion, revenue, service mix, repeat rate, cancellation rate, and no-shows.
- [ ] **Measure acquisition sources.** Attribute bookings to Instagram, Google Business Profile, referrals, and campaigns.
- [ ] **Track capacity utilization.** Identify high-demand periods and underbooked hours.
- [ ] **Add privacy-conscious product analytics.** Avoid collecting unnecessary personal data.

### Architecture for Growth

- [ ] **Evaluate PostgreSQL migration.** Move when concurrent traffic, reporting, or multi-instance deployment exceeds SQLite's operational fit.
- [ ] **Move uploads to private object storage.** Use signed owner-only URLs, lifecycle rules, encryption, and malware scanning.
- [ ] **Introduce a background job queue.** Move email, SMS, reminders, image processing, and webhooks out of request handlers.
- [ ] **Add monitoring and alerting.** Track latency, error rate, booking failures, queue failures, storage usage, and backup status.

### Later Exit Criteria

- Deposits and policies measurably reduce no-shows.
- Rebooking, packages, or referrals produce repeat revenue.
- Operational analytics support staffing, pricing, and promotion decisions.
- The platform can deploy safely across multiple application instances if needed.

---

## Future: PinkSpa Platform Expansion

**Target horizon:** 6-12+ months  
**Primary outcome:** PinkSpa can expand beyond a single-provider booking tool while maintaining service quality and brand consistency.

### Multi-Provider and Multi-Location

- [ ] Add staff profiles, specialties, schedules, commissions, and service eligibility.
- [ ] Let clients choose a provider or request the first available provider.
- [ ] Support multiple rooms, chairs, or simultaneous resource constraints.
- [ ] Add multiple locations with independent hours, services, pricing, inventory, and reporting.
- [ ] Add role-based access for owner, manager, receptionist, and technician accounts.

### Advanced Client Experience

- [ ] Create a complete client portal and digital loyalty wallet.
- [ ] Add personalized service recommendations based on preferences and booking history.
- [ ] Let clients organize inspiration boards and attach multiple reference images.
- [ ] Add virtual consultations for higher-value services.
- [ ] Offer multilingual booking and communication.
- [ ] Expand the PWA into a polished app-like experience with offline-safe browsing and push notifications.

### Commerce and Operations

- [ ] Add retail product sales, inventory, low-stock alerts, and service-product usage.
- [ ] Support subscriptions, membership billing, package balances, and family gifting.
- [ ] Add payroll and commission exports.
- [ ] Integrate accounting and customer relationship platforms.
- [ ] Add Google Calendar, Apple Calendar, and external booking-channel synchronization.

### Strategic Opportunities

- [ ] Build a branded portfolio from approved before-and-after photos with explicit client consent.
- [ ] Use aggregated demand data to optimize hours, pricing, staffing, and promotions.
- [ ] Offer automated post-visit care instructions by service.
- [ ] Evaluate responsible AI-assisted inspiration categorization or style matching, with human review and clear privacy controls.
- [ ] Consider a reusable white-label platform only after PinkSpa's own workflows are stable and profitable.

### Future Guardrails

- Preserve client consent and privacy as new data types are introduced.
- Keep scheduling and payment rules authoritative on the server.
- Require accessibility, security review, observability, and automated tests for every major feature.
- Prefer measurable business outcomes over feature volume.

---

## Recommended Delivery Order

1. Close XSS, status-privacy, credential, session, and abuse-control risks.
2. Establish tests, migrations, backups, logging, and production deployment standards.
3. Make scheduling configuration and multi-service data authoritative on the server.
4. Add confirmations, status notifications, and reminders.
5. Complete accessibility, mobile, stylesheet, and image-performance work.
6. Add deposits, policies, waitlists, and rebooking.
7. Add analytics, accounts, loyalty, and growth architecture only after operational stability.

## Roadmap Review Cadence

- Review **Now** items weekly until production-readiness exit criteria are met.
- Review the full roadmap monthly with product, operations, and engineering input.
- Promote work based on customer impact, security risk, owner time saved, and measurable revenue potential.
- Record completed milestones in this document and move newly discovered work into the appropriate horizon.
