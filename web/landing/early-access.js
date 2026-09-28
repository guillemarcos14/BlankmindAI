(() => {
  const phoneForm = document.querySelector("#phone-form");
  const codeForm = document.querySelector("#code-form");
  const phoneInput = document.querySelector("#phone");
  const channelInput = document.querySelector("#channel");
  const codeInput = document.querySelector("#code");
  const consentInput = document.querySelector("#consent");
  const status = document.querySelector("#status");
  let phone = "";
  let channel = new URLSearchParams(window.location.search).get("channel") === "sms" ? "sms" : "whatsapp";
  channelInput.value = channel;

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("is-error", isError);
  }

  async function post(path, body, accessToken = "") {
    const response = await fetch(`/.netlify/functions/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || payload.error || "Something went wrong");
    return payload;
  }

  phoneForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!consentInput.checked) {
      setStatus("Please confirm that I can message you and save the conversation.", true);
      return;
    }
    phone = phoneInput.value.trim();
    channel = channelInput.value === "sms" ? "sms" : "whatsapp";
    phoneForm.querySelector("button").disabled = true;
    setStatus("I’m sending your verification code now.");
    try {
      const result = await post("waitlist-auth", { action: "request_otp", phone, channel });
      phone = result.phone_e164 || phone;
      phoneForm.hidden = true;
      codeForm.hidden = false;
      codeInput.focus();
      setStatus("I sent the verification code by SMS. Enter it here when it arrives.");
    } catch (error) {
      setStatus(error.message, true);
      phoneForm.querySelector("button").disabled = false;
    }
  });

  codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    codeForm.querySelector("button").disabled = true;
    setStatus("I’m verifying your number.");
    try {
      const verified = await post("waitlist-auth", {
        action: "verify_otp",
        phone,
        code: codeInput.value.trim(),
      });
      await post("waitlist-start", {
        data_consent: true,
        channel,
        messaging_consent: true,
        whatsapp_consent: true,
      }, verified.access_token);
      codeForm.hidden = true;
      setStatus(`You’re in. I’ve just started our conversation on ${channel === "sms" ? "Messages" : "WhatsApp"}.`);
    } catch (error) {
      setStatus(error.message, true);
      codeForm.querySelector("button").disabled = false;
    }
  });
})();
