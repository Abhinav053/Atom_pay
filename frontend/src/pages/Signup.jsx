import { useState } from "react";
import { api } from "../api";
import AtomLoader from "../components/AtomLoader";
import RoyalWelcome from "../components/RoyalWelcome";
import "../styles/auth.css";

export default function Signup({ onLogin, goToLogin }) {
  const [form, setForm] = useState({ name: "", email: "", username: "", password: "", pin: "", otp: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [welcome, setWelcome] = useState(null); // { name, auth } once account is created

  const handleSendOTP = async () => {
    setError("");
    if (!form.name || !form.email || !form.username || !form.password || !form.pin)
      return setError("Fill all fields");
    if (form.pin.length !== 6 || !/^\d{6}$/.test(form.pin))
      return setError("PIN must be exactly 6 digits");
    if (form.password.length < 8)
      return setError("Password must be at least 8 characters");

    setLoading(true);
    try {
      await api("/auth/send-signup-otp", {
        method: "POST",
        body: JSON.stringify({ email: form.email }),
      });
      setOtpSent(true);
    } catch (err) {
      setError(err.message || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    setError("");
    if (form.otp.length !== 6 || !/^\d{6}$/.test(form.otp))
      return setError("OTP must be exactly 6 digits");

    setLoading(true);
    try {
      const data = await api("/auth/signup", {
        method: "POST",
        body: JSON.stringify(form),
      });
      // Brand-new sovereign — crown them before they enter.
      setWelcome({ name: form.name || data.user?.username || "Guest", auth: data });
    } catch (err) {
      setError(err.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  const f = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  // A first-ever sovereign — full coronation, then into the kingdom.
  if (welcome) {
    return (
      <RoyalWelcome
        name={welcome.name}
        isNewUser={true}
        onEnter={() =>
          onLogin(welcome.auth.accessToken, welcome.auth.refreshToken, welcome.auth.user)
        }
      />
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-orb auth-orb-1" />
      <div className="auth-orb auth-orb-2" />
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-crown">♛</div>
          <AtomLoader size={56} royal />
          <div className="auth-wordmark">Atom<span>Pay</span></div>
        </div>
        <div className="auth-host">
          <span /><em>Your host, <strong>Akshay Dhankhar</strong></em><span />
        </div>
        <p className="auth-subtitle">Claim your throne — and a ₹500,000 royal treasury to begin</p>

        <div className="auth-form">
          {!otpSent ? (
            <>
              {[
                { key: "name", label: "Full Name", placeholder: "Akshay Dhankhar", type: "text" },
                { key: "email", label: "Email", placeholder: "akshay@example.com", type: "email" },
                { key: "username", label: "Username", placeholder: "akshay123", type: "text" },
                { key: "password", label: "Password", placeholder: "Min 8 characters", type: "password" },
                { key: "pin", label: "UPI PIN (6 digits)", placeholder: "••••••", type: "password" },
              ].map(({ key, label, placeholder, type }) => (
                <div className="input-group" key={key}>
                  <label>{label}</label>
                  <input
                    type={type}
                    placeholder={placeholder}
                    value={form[key]}
                    onChange={f(key)}
                    maxLength={key === "pin" ? 6 : undefined}
                  />
                </div>
              ))}

              {error && <div className="auth-error">{error}</div>}

              <button className="auth-btn" onClick={handleSendOTP} disabled={loading}>
                {loading ? <AtomLoader size={22} /> : "Send OTP"}
              </button>
            </>
          ) : (
            <>
              <div className="input-group">
                <label>Enter OTP Code</label>
                <input
                  type="text"
                  placeholder="6 digit OTP from your email"
                  value={form.otp}
                  onChange={f("otp")}
                  maxLength={6}
                />
              </div>

              {error && <div className="auth-error">{error}</div>}

              <button className="auth-btn" onClick={handleSubmit} disabled={loading}>
                {loading ? <AtomLoader size={22} /> : "Create Account"}
              </button>
            </>
          )}

          <p className="auth-switch">
            Already have an account?{" "}
            <span onClick={goToLogin}>Log in</span>
          </p>

          <p className="auth-seal">
            Crafted in gold by <strong>Akshay Dhankhar</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
