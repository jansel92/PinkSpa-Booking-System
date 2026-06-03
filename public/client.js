const imageFallbacks = {
  nails: "https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=900&q=85",
  pedi: "https://images.unsplash.com/photo-1519014816548-bf5fe059798b?auto=format&fit=crop&w=900&q=85",
  lashes: "https://images.unsplash.com/photo-1589710751893-f9a6770ad71b?auto=format&fit=crop&w=900&q=85",
  brows: "https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=900&q=85"
};

function categoryImage(service) {
  if (service.image) return service.image;
  const c = service.category.toLowerCase();
  if (c.includes("pedi")) return imageFallbacks.pedi;
  if (c.includes("lash")) return imageFallbacks.lashes;
  if (c.includes("brow") || c.includes("eye")) return imageFallbacks.brows;
  return imageFallbacks.nails;
}

async function loadSettings() {
  const settings = await fetch("/api/settings").then(r => r.json());
  document.getElementById("hoursText").textContent = settings.hours;
  document.getElementById("cityText").textContent = "📍 " + settings.city;
  document.getElementById("businessPhoneText").textContent = "☎ " + settings.phone;
  document.getElementById("businessHoursText").textContent = "🕘 " + settings.hours;
  document.getElementById("phoneLink").href = "tel:" + settings.phone;
  document.getElementById("phoneLink").textContent = "Call " + settings.phone;
  document.getElementById("ctaPhone").href = "tel:" + settings.phone;
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
        <h3>${service.name}</h3>
        <strong>${service.price}</strong>
        <p>${service.category} • ${service.duration} minutes</p>
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
