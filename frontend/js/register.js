// js/register.js — handles the public registration/follow-up form

// Highlight the selected radio option visually.
document.querySelectorAll("#contact-pref-group input[type=radio]").forEach((input) => {
    input.addEventListener("change", () => {
        document.querySelectorAll("#contact-pref-group .radio-option").forEach((el) => el.classList.remove("selected"));
        input.closest(".radio-option").classList.add("selected");
    });
    if (input.checked) input.closest(".radio-option").classList.add("selected");
});

document.getElementById("register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const alertBox = document.getElementById("alert-box");
    const submitBtn = document.getElementById("submit-btn");

    const contactPref = document.querySelector("#contact-pref-group input[name=contact_preference]:checked").value;

    const payload = {
        full_name: document.getElementById("full_name").value.trim(),
        email: document.getElementById("email").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        contact_preference: contactPref,
        notes: document.getElementById("notes").value.trim(),
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    try {
        await Api.post("/registrations", payload, { auth: false });
        showAlert(alertBox, "Thanks! Someone from our team will reach out to you soon.", "success");
        e.target.reset();
        document.querySelectorAll("#contact-pref-group .radio-option").forEach((el) => el.classList.remove("selected"));
        document.querySelector('#contact-pref-group input[value="email"]').closest(".radio-option").classList.add("selected");
    } catch (err) {
        showAlert(alertBox, err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit";
    }
});
