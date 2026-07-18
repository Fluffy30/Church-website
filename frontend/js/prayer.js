// js/prayer.js — handles the prayer request submission form
document.getElementById("prayer-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const alertBox = document.getElementById("alert-box");
    const submitBtn = document.getElementById("submit-btn");

    const payload = {
        full_name: document.getElementById("is_anonymous").checked
            ? "Anonymous"
            : document.getElementById("full_name").value.trim(),
        is_anonymous: document.getElementById("is_anonymous").checked,
        contact_info: document.getElementById("contact_info").value.trim(),
        request_text: document.getElementById("request_text").value.trim(),
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    try {
        await Api.post("/prayers", payload, { auth: true }); // auth optional server-side; sent if logged in
        showAlert(
            alertBox,
            "Your prayer request has been received privately. Our team will be praying for you.",
            "success"
        );
        e.target.reset();
    } catch (err) {
        showAlert(alertBox, err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Privately";
    }
});

// Visually mark the name field as optional/disabled when "anonymous" is checked.
document.getElementById("is_anonymous").addEventListener("change", (e) => {
    const nameField = document.getElementById("full_name");
    if (e.target.checked) {
        nameField.removeAttribute("required");
        nameField.disabled = true;
        nameField.placeholder = "Not needed — submitting anonymously";
    } else {
        nameField.setAttribute("required", "required");
        nameField.disabled = false;
        nameField.placeholder = "e.g. John Doe";
    }
});
