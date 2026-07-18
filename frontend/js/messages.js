// js/messages.js — real-time WhatsApp-like group messaging
// -----------------------------------------------------------------------
// Flow:
//   1. Load the list of groups the user belongs to (GET /api/groups)
//   2. Connect a Socket.IO client, authenticated with the JWT
//   3. When a group is selected: load history over REST, then join the
//      socket room for live updates
//   4. Sending a message goes over the socket for instant delivery to
//      everyone else in the room
// -----------------------------------------------------------------------

if (!Auth.isLoggedIn()) {
    // The guest-gate section in the HTML handles messaging for logged-out
    // users; just stop here so we don't try to hit authenticated endpoints.
} else {
    let socket = null;
    let currentGroupId = null;
    let typingTimeout = null;

    const groupListEl = document.getElementById("group-list");
    const chatHeaderEl = document.getElementById("chat-header");
    const chatMessagesEl = document.getElementById("chat-messages");
    const messageInputEl = document.getElementById("message-input");
    const sendBtn = document.getElementById("send-btn");
    const alertBox = document.getElementById("alert-box");
    const typingIndicatorEl = document.getElementById("typing-indicator");

    const me = Auth.getUser();

    init();

    async function init() {
        connectSocket();
        await loadGroups();
        setupNewGroupModal();
    }

    function connectSocket() {
        socket = io(CONFIG.SOCKET_URL, { auth: { token: Auth.getToken() } });

        socket.on("connect_error", (err) => {
            showAlert(alertBox, "Real-time connection failed: " + err.message);
        });

        socket.on("new_message", (message) => {
            if (message && currentGroupId && String(message.group_id ?? currentGroupId) === String(currentGroupId)) {
                appendMessage(message);
            }
        });

        socket.on("user_typing", (data) => {
            if (data.userId === me.id) return;
            typingIndicatorEl.textContent = `${data.name} is typing…`;
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => (typingIndicatorEl.textContent = ""), 2000);
        });
    }

    async function loadGroups() {
        try {
            const { groups } = await Api.get("/groups");
            if (!groups.length) {
                groupListEl.innerHTML = `<p class="muted" style="padding:16px;">You're not in any groups yet. ${
                    Auth.hasRole("admin", "leader") ? "Create one to get started." : "A leader will add you to one soon."
                }</p>`;
                return;
            }
            groupListEl.innerHTML = groups
                .map(
                    (g) => `
        <div class="group-item" data-group-id="${g.id}" data-group-name="${escapeHtml(g.name)}">
          <div class="group-name">${escapeHtml(g.name)}</div>
          <div class="group-desc">${escapeHtml(g.description || "")}</div>
        </div>`
                )
                .join("");

            document.querySelectorAll(".group-item").forEach((el) => {
                el.addEventListener("click", () => selectGroup(el.dataset.groupId, el.dataset.groupName, el));
            });
        } catch (err) {
            showAlert(alertBox, err.message);
        }
    }

    async function selectGroup(groupId, groupName, el) {
        // Leave the previous room.
        if (currentGroupId) socket.emit("leave_group", currentGroupId);

        currentGroupId = groupId;
        document.querySelectorAll(".group-item").forEach((g) => g.classList.remove("active"));
        el.classList.add("active");

        chatHeaderEl.textContent = groupName;
        messageInputEl.disabled = false;
        sendBtn.disabled = false;
        chatMessagesEl.innerHTML = `<p class="muted text-center">Loading messages…</p>`;

        try {
            const { messages } = await Api.get(`/groups/${groupId}/messages`);
            chatMessagesEl.innerHTML = "";
            messages.forEach(appendMessage);
            chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
        } catch (err) {
            showAlert(alertBox, err.message);
        }

        socket.emit("join_group", groupId, (res) => {
            if (res && res.error) showAlert(alertBox, res.error);
        });
    }

    function appendMessage(message) {
        const isOwn = message.sender_id === me.id;
        const div = document.createElement("div");
        div.className = `msg ${isOwn ? "msg-own" : "msg-other"}`;
        div.innerHTML = `
      ${!isOwn ? `<div class="msg-sender">${escapeHtml(message.sender_name)}</div>` : ""}
      <div class="msg-content">${escapeHtml(message.content)}</div>
      <div class="msg-time">${new Date(message.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
    `;
        chatMessagesEl.appendChild(div);
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }

    function sendMessage() {
        const content = messageInputEl.value.trim();
        if (!content || !currentGroupId) return;
        socket.emit("send_message", { groupId: currentGroupId, content }, (res) => {
            if (res && res.error) showAlert(alertBox, res.error);
        });
        messageInputEl.value = "";
    }

    sendBtn.addEventListener("click", sendMessage);
    messageInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") sendMessage();
        else if (currentGroupId) socket.emit("typing", currentGroupId);
    });

    // ---------------- New group modal (admin/leader) ----------------
    function setupNewGroupModal() {
        const modal = document.getElementById("new-group-modal");
        const newGroupBtn = document.getElementById("new-group-btn");
        const cancelBtn = document.getElementById("cancel-group-btn");
        const form = document.getElementById("new-group-form");
        if (!newGroupBtn) return;

        newGroupBtn.addEventListener("click", () => (modal.style.display = "flex"));
        cancelBtn.addEventListener("click", () => (modal.style.display = "none"));

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const modalAlert = document.getElementById("modal-alert-box");
            try {
                await Api.post("/groups", {
                    name: document.getElementById("group-name").value.trim(),
                    description: document.getElementById("group-desc").value.trim(),
                });
                modal.style.display = "none";
                form.reset();
                await loadGroups();
            } catch (err) {
                showAlert(modalAlert, err.message);
            }
        });
    }
}
