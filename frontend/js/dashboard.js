// js/dashboard.js — staff dashboard logic
// -----------------------------------------------------------------------
// Guards the page for admin/leader only, then wires up each tab's data
// loading and forms. Kept in one file for simplicity; feel free to split
// into per-tab files as the dashboard grows.
// -----------------------------------------------------------------------

if (!Auth.isLoggedIn()) {
    // guest-gate section in the HTML already covers this case
} else if (!Auth.hasRole("admin", "leader")) {
    document.getElementById("member-denied").style.display = "block";
} else {
    const alertBox = document.getElementById("alert-box");

    // ---------------- Tab switching ----------------
    document.querySelectorAll(".tab-link").forEach((link) => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            document.querySelectorAll(".tab-link").forEach((l) => l.classList.remove("active"));
            document.querySelectorAll(".tab-panel").forEach((p) => (p.style.display = "none"));
            link.classList.add("active");
            document.getElementById(`tab-${link.dataset.tab}`).style.display = "block";
        });
    });

    init();

    async function init() {
        await Promise.all([loadEvents(), loadPrayers(), loadRegistrations(), loadMembers(), loadGroups()]);
    }

    // =====================================================================
    // EVENTS
    // =====================================================================
    const eventForm = document.getElementById("event-form");

    document.getElementById("show-event-form-btn").addEventListener("click", () => {
        eventForm.reset();
        document.getElementById("event-id").value = "";
        eventForm.style.display = "block";
    });
    document.getElementById("cancel-event-btn").addEventListener("click", () => (eventForm.style.display = "none"));

    eventForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = document.getElementById("event-id").value;
        const payload = {
            title: document.getElementById("event-title").value.trim(),
            description: document.getElementById("event-description").value.trim(),
            location: document.getElementById("event-location").value.trim(),
            event_date: new Date(document.getElementById("event-date").value).toISOString(),
        };
        try {
            if (id) await Api.put(`/events/${id}`, payload);
            else await Api.post("/events", payload);
            eventForm.style.display = "none";
            await loadEvents();
        } catch (err) {
            showAlert(alertBox, err.message);
        }
    });

    async function loadEvents() {
        const wrap = document.getElementById("events-table-wrap");
        try {
            const { events } = await Api.get("/events");
            if (!events.length) {
                wrap.innerHTML = `<div class="empty-state">No events yet. Create the first one above.</div>`;
                return;
            }
            wrap.innerHTML = `
        <table><thead><tr><th>Title</th><th>Date</th><th>Location</th><th></th></tr></thead>
        <tbody>
          ${events
                .map(
                    (ev) => `
            <tr>
              <td>${escapeHtml(ev.title)}</td>
              <td>${formatDate(ev.event_date)}</td>
              <td>${escapeHtml(ev.location)}</td>
              <td>
                <button class="btn btn-outline btn-sm" onclick="editEvent(${ev.id})">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteEvent(${ev.id})">Delete</button>
              </td>
            </tr>`
                )
                .join("")}
        </tbody></table>`;
            window._eventsCache = events;
        } catch (err) {
            showAlert(alertBox, err.message);
        }
    }

    window.editEvent = (id) => {
        const ev = window._eventsCache.find((e) => e.id === id);
        if (!ev) return;
        document.getElementById("event-id").value = ev.id;
        document.getElementById("event-title").value = ev.title;
        document.getElementById("event-description").value = ev.description;
        document.getElementById("event-location").value = ev.location;
        document.getElementById("event-date").value = ev.event_date.slice(0, 16);
        eventForm.style.display = "block";
        eventForm.scrollIntoView({ behavior: "smooth" });
    };

    window.deleteEvent = async (id) => {
        if (!confirm("Delete this event? This cannot be undone.")) return;
        try {
            await Api.del(`/events/${id}`);
            await loadEvents();
        } catch (err) {
            showAlert(alertBox, err.message);
        }
    };

    // =====================================================================
    // PRAYER REQUESTS
    // =====================================================================
    async function loadPrayers() {
        const wrap = document.getElementById("prayers-table-wrap");
        try {
            const { prayers } = await Api.get("/prayers");
            if (!prayers.length) {
                wrap.innerHTML = `<div class="empty-state">No prayer requests yet.</div>`;
                return;
            }
            const badge = { new: "badge-new", in_progress: "badge-progress", prayed_for: "badge-done" };
            wrap.innerHTML = `
        <table><thead><tr><th>From</th><th>Request</th><th>Contact</th><th>Status</th><th>Submitted</th></tr></thead>
        <tbody>
          ${prayers
                .map(
                    (p) => `
            <tr>
              <td>${escapeHtml(p.full_name)}</td>
              <td style="max-width:320px;">${escapeHtml(p.request_text)}</td>
              <td>${escapeHtml(p.contact_info || "—")}</td>
              <td>
                <select onchange="updatePrayerStatus(${p.id}, this.value)" style="width:auto; padding:6px 8px;">
                  <option value="new" ${p.status === "new" ? "selected" : ""}>New</option>
                  <option value="in_progress" ${p.status === "in_progress" ? "selected" : ""}>In Progress</option>
                  <option value="prayed_for" ${p.status === "prayed_for" ? "selected" : ""}>Prayed For</option>
                </select>
              </td>
              <td>${formatDate(p.created_at)}</td>
            </tr>`
                )
                .join("")}
        </tbody></table>`;
        } catch (err) {
            showAlert(alertBox, err.message);
        }
    }

    window.updatePrayerStatus = async (id, status) => {
        try {
            await Api.patch(`/prayers/${id}/status`, { status });
        } catch (err) {
            showAlert(alertBox, err.message);
        }
    };

    // =====================================================================
    // REGISTRATIONS / FOLLOW-UPS
    // =====================================================================
    async function loadRegistrations() {
        const wrap = document.getElementById("registrations-table-wrap");
        try {
            const { registrations } = await Api.get("/registrations");
            if (!registrations.length) {
                wrap.innerHTML = `<div class="empty-state">No new contacts yet.</div>`;
                return;
            }
            wrap.innerHTML = `
        <table><thead><tr><th>Name</th><th>Contact</th><th>Prefers</th><th>Notes</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${registrations
                .map(
                    (r) => `
            <tr>
              <td>${escapeHtml(r.full_name)}</td>
              <td>${escapeHtml(r.email || "")} ${r.phone ? "<br>" + escapeHtml(r.phone) : ""}</td>
              <td><span class="badge badge-member">${escapeHtml(r.contact_preference)}</span></td>
              <td style="max-width:240px;">${escapeHtml(r.notes || "—")}</td>
              <td>${r.followed_up ? '<span class="badge badge-done">Contacted</span>' : '<span class="badge badge-new">Pending</span>'}</td>
              <td>${r.followed_up ? "" : `<button class="btn btn-outline btn-sm" onclick="markFollowedUp(${r.id})">Mark Contacted</button>`}</td>
            </tr>`
                )
                .join("")}
        </tbody></table>`;
        } catch (err) {
            showAlert(alertBox, err.message);
        }
    }

    window.markFollowedUp = async (id) => {
        try {
            await Api.patch(`/registrations/${id}/followed-up`, {});
            await loadRegistrations();
        } catch (err) {
            showAlert(alertBox, err.message);
        }
    };

    // =====================================================================
    // MEMBERS
    // =====================================================================
    async function loadMembers(search = "") {
        const wrap = document.getElementById("members-table-wrap");
        try {
            const { users } = await Api.get(`/users${search ? `?search=${encodeURIComponent(search)}` : ""}`);
            if (!users.length) {
                wrap.innerHTML = `<div class="empty-state">No members found.</div>`;
                return;
            }
            const roleBadge = { admin: "badge-admin", leader: "badge-leader", member: "badge-member" };
            const isAdmin = Auth.hasRole("admin");
            wrap.innerHTML = `
        <table><thead><tr><th>Name</th><th>Email</th><th>Contact Pref.</th><th>Role</th>${isAdmin ? "<th></th>" : ""}</tr></thead>
        <tbody>
          ${users
                .map(
                    (u) => `
            <tr>
              <td>${escapeHtml(u.name)}</td>
              <td>${escapeHtml(u.email)}</td>
              <td>${escapeHtml(u.contact_preference)}</td>
              <td><span class="badge ${roleBadge[u.role]}">${u.role}</span></td>
              ${
                        isAdmin
                            ? `<td>
                      <select onchange="updateUserRole(${u.id}, this.value)" style="width:auto; padding:6px 8px;">
                        <option value="member" ${u.role === "member" ? "selected" : ""}>Member</option>
                        <option value="leader" ${u.role === "leader" ? "selected" : ""}>Leader</option>
                        <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
                      </select>
                    </td>`
                            : ""
                    }
            </tr>`
                )
                .join("")}
        </tbody></table>`;
            window._usersCache = users;
        } catch (err) {
            showAlert(alertBox, err.message);
        }
    }

    window.updateUserRole = async (id, role) => {
        try {
            await Api.patch(`/users/${id}/role`, { role });
            await loadMembers(document.getElementById("member-search").value.trim());
        } catch (err) {
            showAlert(alertBox, err.message);
        }
    };

    let searchTimeout;
    document.getElementById("member-search").addEventListener("input", (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => loadMembers(e.target.value.trim()), 300);
    });

    // =====================================================================
    // GROUPS
    // =====================================================================
    const groupForm = document.getElementById("group-form");
    document.getElementById("show-group-form-btn").addEventListener("click", () => {
        groupForm.reset();
        groupForm.style.display = "block";
    });
    document.getElementById("cancel-group-btn").addEventListener("click", () => (groupForm.style.display = "none"));

    groupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            await Api.post("/groups", {
                name: document.getElementById("group-name").value.trim(),
                description: document.getElementById("group-desc").value.trim(),
            });
            groupForm.style.display = "none";
            await loadGroups();
        } catch (err) {
            showAlert(alertBox, err.message);
        }
    });

    async function loadGroups() {
        const wrap = document.getElementById("groups-list-wrap");
        try {
            const { groups } = await Api.get("/groups");
            if (!groups.length) {
                wrap.innerHTML = `<div class="empty-state">No groups yet. Create one above.</div>`;
                return;
            }
            wrap.innerHTML = groups
                .map(
                    (g) => `
        <div class="card" style="margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <h3 style="margin-bottom:2px;">${escapeHtml(g.name)}</h3>
              <p class="muted" style="margin:0;">${escapeHtml(g.description || "")}</p>
            </div>
            <a href="messages.html" class="btn btn-outline btn-sm">Open Chat</a>
          </div>
          <div id="group-members-${g.id}" style="margin-top:14px;">Loading members…</div>
          <div style="margin-top:12px; display:flex; gap:8px;">
            <select id="add-member-select-${g.id}" style="flex:1;"><option>Loading members list…</option></select>
            <button class="btn btn-primary btn-sm" onclick="addGroupMember(${g.id})">Add</button>
          </div>
        </div>`
                )
                .join("");

            groups.forEach((g) => loadGroupMembers(g.id));
            populateMemberSelects(groups);
        } catch (err) {
            showAlert(alertBox, err.message);
        }
    }

    async function loadGroupMembers(groupId) {
        const el = document.getElementById(`group-members-${groupId}`);
        try {
            const { members } = await Api.get(`/groups/${groupId}/members`);
            el.innerHTML = members.length
                ? members
                    .map(
                        (m) => `
          <span class="badge badge-member" style="margin:2px 4px 2px 0; display:inline-flex; align-items:center; gap:6px;">
            ${escapeHtml(m.name)}
            <a href="#" onclick="removeGroupMember(${groupId}, ${m.id}); return false;" style="color:inherit;">✕</a>
          </span>`
                    )
                    .join("")
                : `<p class="muted" style="margin:0;">No members yet.</p>`;
        } catch (err) {
            el.innerHTML = `<p class="muted">Could not load members.</p>`;
        }
    }

    async function populateMemberSelects(groups) {
        try {
            const { users } = await Api.get("/users");
            groups.forEach((g) => {
                const sel = document.getElementById(`add-member-select-${g.id}`);
                if (sel) {
                    sel.innerHTML = users.map((u) => `<option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.email)})</option>`).join("");
                }
            });
        } catch (err) {
            // Non-critical; leave selects showing the loading state.
        }
    }

    window.addGroupMember = async (groupId) => {
        const sel = document.getElementById(`add-member-select-${groupId}`);
        const userId = sel.value;
        if (!userId) return;
        try {
            await Api.post(`/groups/${groupId}/members`, { user_id: Number(userId) });
            await loadGroupMembers(groupId);
        } catch (err) {
            showAlert(alertBox, err.message);
        }
    };

    window.removeGroupMember = async (groupId, userId) => {
        try {
            await Api.del(`/groups/${groupId}/members/${userId}`);
            await loadGroupMembers(groupId);
        } catch (err) {
            showAlert(alertBox, err.message);
        }
    };
}
