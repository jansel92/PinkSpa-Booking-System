const imageFallbacks = {
  nails: "/images/nails/nails1.jpeg",
  pedi: "/images/pedicure/pedi1.png",
  lashes: "/images/lashes/lashes1.jpeg",
  brows: "/images/brows/brows1.jpeg"
};

function categoryImage(service) {
  if (service.image) return service.image;

  const category = (service.category || "").toLowerCase();
  const name = (service.name || "").toLowerCase();
  const text = category + " " + name;

  if (text.includes("pedi") || text.includes("toe") || text.includes("foot")) {
    return imageFallbacks.pedi;
  }

  if (text.includes("lash") || text.includes("eyelash")) {
    return imageFallbacks.lashes;
  }

  if (text.includes("brow") || text.includes("eyebrow") || text.includes("wax") || text.includes("henna") || text.includes("lamination")) {
    return imageFallbacks.brows;
  }

  return imageFallbacks.nails;
}

async function loadSettings() {
  const settings = await fetch("/api/settings").then(r => r.json());

  const cityText = document.getElementById("cityText");
  const businessPhoneText = document.getElementById("businessPhoneText");
  const businessHoursText = document.getElementById("businessHoursText");
  const phoneLink = document.getElementById("phoneLink");
  const ctaPhone = document.getElementById("ctaPhone");

  if (cityText) cityText.textContent = "📍 " + settings.city;
  if (businessPhoneText) businessPhoneText.textContent = "☎ " + settings.phone;
  if (businessHoursText) businessHoursText.textContent = "🕘 " + settings.hours;

  if (phoneLink) {
    phoneLink.href = "tel:" + settings.phone;
    phoneLink.textContent = "Call " + settings.phone;
  }

  if (ctaPhone) {
    ctaPhone.href = "tel:" + settings.phone;
  }
}

async function loadServices() {
  const services = await fetch("/api/services").then(r => r.json());
  const grid = document.getElementById("serviceGrid");
  const select = document.getElementById("serviceSelect");

  grid.innerHTML = "";
  select.innerHTML = "";

  services.forEach(service => {
    const card = document.createElement("article");
    card.className = "service-card";

    card.innerHTML = `
      <div class="service-card-img" style="background-image:url('${categoryImage(service)}')"></div>
      <div class="service-card-body">
        <span class="service-category">${service.category}</span>
        <h3>${service.name}</h3>
        <strong>${service.price}</strong>
        <p>${service.duration} minutes</p>
        <a class="service-book-btn" href="#book">Book This Service</a>
      </div>
    `;

    grid.appendChild(card);

    const option = document.createElement("option");
    option.value = service.id;
    option.textContent = `${service.name} - ${service.price}`;
    select.appendChild(option);
  });
}

document.getElementById("bookingForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = new FormData(e.target);
  const payload = Object.fromEntries(form.entries());
  const message = document.getElementById("bookingMessage");

  const response = await fetch("/api/appointments", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    message.textContent = data.error || "Something went wrong.";
    return;
  }

  e.target.reset();
  message.textContent = "Your appointment request was sent to PinkSpa.";
});

loadSettings();
loadServices();
