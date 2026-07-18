// js/api.js
// -----------------------------------------------------------------------
// Small helper library used by every page:
//   - stores/reads the JWT + logged-in user from localStorage
//   - wraps fetch() so every request automatically sends the token and
//     parses JSON/error responses consistently
//
// NOTE ON SECURITY: storing the JWT in localStorage is simple and works
// well for this project, but it is readable by any JS running on the
// page (XSS risk). For a production deployment with stricter needs,
// consider switching to an httpOnly cookie issued by the backend instead
// (would require small changes to routes/auth.js on the server).
// -----------------------------------------------------------------------

const Auth = {
    TOKEN_KEY: "church_token",
    USER_KEY: "church_user",

    getToken() {
        return localStorage.getItem(this.TOKEN_KEY);
    },
    getUser() {
        const raw = localStorage.getItem(this.USER_KEY);
        return raw ? JSON.parse(raw) : null;
    },
    isLoggedIn() {
        return !!this.getToken();
    },
    hasRole(...roles) {
        const user = this.getUser();
        return !!user && roles.includes(user.role);
    },
    setSession(token, user) {
        localStorage.setItem(this.TOKEN_KEY, token);
        localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    },
    logout() {
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.USER_KEY);
        window.location.href = "login.html";
    },
};

const Api = {
    // Generic request wrapper. `path` should start with "/", e.g. "/events".
    async request(path, { method = "GET", body, auth = true } = {}) {
        const headers = { "Content-Type": "application/json" };
        if (auth && Auth.getToken()) {
            headers["Authorization"] = `Bearer ${Auth.getToken()}`;
        }

        let response;
        try {
            response = await fetch(`${CONFIG.API_BASE_URL}${path}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
            });
        } catch (networkErr) {
            throw new Error("Could not reach the server. Please check your connection and try again.");
        }

        let data = null;
        try {
            data = await response.json();
        } catch (parseErr) {
            // No JSON body (e.g. some 204 responses) — that's fine.
        }

        if (!response.ok) {
            const message =
                (data && data.error) ||
                (data && data.errors && data.errors[0] && data.errors[0].msg) ||
                "Something went wrong. Please try again.";
            // If the session is invalid/expired, clear it so the UI reflects that.
            if (response.status === 401) {
                Auth.logout();
            }
            throw new Error(message);
        }

        return data;
    },

    get(path) { return this.request(path, { method: "GET" }); },
    post(path, body, opts = {}) { return this.request(path, { method: "POST", body, ...opts }); },
    put(path, body) { return this.request(path, { method: "PUT", body }); },
    patch(path, body) { return this.request(path, { method: "PATCH", body }); },
    del(path) { return this.request(path, { method: "DELETE" }); },
};

// Small helper to show a dismissible alert box inside a container element.
function showAlert(containerEl, message, type = "error") {
    containerEl.innerHTML = `<div class="alert alert-${type === "error" ? "error" : "success"}">${escapeHtml(message)}</div>`;
}

// Prevent HTML injection when rendering any user-supplied text.
function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}

function formatDate(isoString) {
    const d = new Date(isoString);
    if (isNaN(d)) return isoString;
    return d.toLocaleString(undefined, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}
