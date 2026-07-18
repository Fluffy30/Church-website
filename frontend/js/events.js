// js/events.js — renders the full events list on events.html
(async function loadEvents() {
    const listEl = document.getElementById("events-list");
    const alertBox = document.getElementById("alert-box");

    try {
        const { events } = await Api.get("/events");

        if (!events.length) {
            listEl.innerHTML = `<div class="empty-state">No events have been posted yet. Please check back soon!</div>`;
            return;
        }

        const now = new Date();
        listEl.innerHTML = events
            .map((ev) => {
                const isPast = new Date(ev.event_date) < now;
                return `
          <div class="card event-card" style="${isPast ? "opacity:0.6;" : ""}">
            <span class="event-date">${formatDate(ev.event_date)}</span>
            ${isPast ? '<span class="badge badge-member" style="margin-left:8px;">Past</span>' : ""}
            <h3>${escapeHtml(ev.title)}</h3>
            <p class="muted">${escapeHtml(ev.description)}</p>
            <div class="event-location">📍 ${escapeHtml(ev.location)}</div>
          </div>
        `;
            })
            .join("");
    } catch (err) {
        showAlert(alertBox, err.message);
        listEl.innerHTML = "";
    }
})();
