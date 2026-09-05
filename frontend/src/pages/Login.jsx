import { useState } from "react";
import { api } from "../api";
import AtomLoader from "../components/AtomLoader";
import RoyalWelcome from "../components/RoyalWelcome";
import "../styles/auth.css";

export default function Login({ onLogin, goToSignup }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ email: "", password: "", otp: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [welcome, setWelcome] = useState(null); // { name, auth } once authenticated
  const [mode, setMode] = useState("login");    // "login" | "forgot"
  const [reset, setReset] = useState({ otpSent: false, otp: "", newPassword: "" });
  const [info, setInfo] = useState("");         // success / informational message

  const startCooldown = () => {
    setCooldown(60);
    const timer = setInterval(() => {
      setCooldown(c => {
        if (c <= 1) { clearInterval(timer); return 0; }
        return c - 1;
      });
    }, 1000);
  };

  const handleSendOTP = async () => {
    setError("");
    if (!form.email || !form.password)
      return setError("Enter your email and password");
    setLoading(true);
    try {
      await api("/auth/send-otp", {
        method: "POST",
        body: JSON.stringify({ email: form.email, password: form.password }),
      });
      setStep(2);
      startCooldown();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    setError("");
    if (!form.otp || form.otp.length !== 6)
      return setError("Enter the 6-digit OTP");
    setLoading(true);
    try {
      const data = await api("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ email: form.email, otp: form.otp }),
      });
      // Hold the session and roll out the red carpet before entering.
      setWelcome({ name: data.user?.name || data.user?.username || "Guest", auth: data });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openForgot = () => {
    setMode("forgot");
    setError(""); setInfo("");
    setReset({ otpSent: false, otp: "", newPassword: "" });
  };

  const backToLogin = () => {
    setMode("login");
    setError(""); setReset({ otpSent: false, otp: "", newPassword: "" });
  };

  const handleForgotSend = async () => {
    setError(""); setInfo("");
    if (!form.email) return setError("Enter your email");
    setLoading(true);
    try {
      const data = await api("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: form.email }),
      });
      setReset(r => ({ ...r, otpSent: true }));
      setInfo(data.msg || "If an account exists, a reset code has been sent.");
      startCooldown();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setError(""); setInfo("");
    if (!reset.otp || reset.otp.length !== 6) return setError("Enter the 6-digit OTP");
    if (reset.newPassword.length < 8) return setError("Password must be at least 8 characters");
    setLoading(true);
    try {
      await api("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email: form.email, otp: reset.otp, newPassword: reset.newPassword }),
      });
      setMode("login"); setStep(1);
      setReset({ otpSent: false, otp: "", newPassword: "" });
      setForm({ ...form, password: "", otp: "" });
      setInfo("Password reset! Log in with your new password.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // A returning sovereign — royal homecoming, then into the kingdom.
  if (welcome) {
    return (
      <RoyalWelcome
        name={welcome.name}
        isNewUser={false}
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
          <div className="auth-wordmark">
            Atom<span>Pay</span>
          </div>
        </div>

        {/* <div className="auth-host">
          <span /><em>Your host, <strong>Akshay Dhankhar</strong></em><span />
        </div> */}

        <p className="auth-subtitle">
          {mode === "forgot"
            ? (reset.otpSent ? `Reset code sent to ${form.email}` : "Reset your password")
            : step === 1
              ? "The royal court of money awaits."
              : `OTP sent to ${form.email}`}
        </p>

        {/* Step indicator (login only) */}
        {mode === "login" && (
          <div className="auth-steps">
            {[1, 2].map(s => (
              <div key={s} className={`auth-step-bar ${step >= s ? "active" : ""}`} />
            ))}
          </div>
        )}

        <div className="auth-form">
          {info && <div className="auth-info">{info}</div>}

          {/* ── Forgot password flow ── */}
          {mode === "forgot" ? (
            <>
              {!reset.otpSent ? (
                <>
                  <div className="input-group">
                    <label>Email</label>
                    <input
                      type="email"
                      placeholder="you@example.com"
                      value={form.email}
                      onChange={e => setForm({ ...form, email: e.target.value })}
                      onKeyDown={e => e.key === "Enter" && handleForgotSend()}
                    />
                  </div>

                  {error && <div className="auth-error">{error}</div>}

                  <button className="auth-btn" onClick={handleForgotSend} disabled={loading}>
                    {loading ? <AtomLoader size={22} /> : "Send reset code →"}
                  </button>
                </>
              ) : (
                <>
                  <div className="input-group">
                    <label>Reset OTP (valid 60 seconds)</label>
                    <input
                      className="otp-input"
                      type="text"
                      placeholder="••••••"
                      maxLength={6}
                      value={reset.otp}
                      onChange={e => setReset({ ...reset, otp: e.target.value.replace(/\D/g, "") })}
                    />
                  </div>
                  <div className="input-group">
                    <label>New Password</label>
                    <input
                      type="password"
                      placeholder="Min 8 characters"
                      value={reset.newPassword}
                      onChange={e => setReset({ ...reset, newPassword: e.target.value })}
                      onKeyDown={e => e.key === "Enter" && handleResetPassword()}
                    />
                  </div>

                  {error && <div className="auth-error">{error}</div>}

                  <button className="auth-btn" onClick={handleResetPassword} disabled={loading}>
                    {loading ? <AtomLoader size={22} /> : "Reset password ⚡"}
                  </button>

                  <button
                    className="auth-btn ghost"
                    onClick={handleForgotSend}
                    disabled={cooldown > 0 || loading}
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                  </button>
                </>
              )}

              <button className="auth-link-btn" onClick={backToLogin}>
                ← Back to login
              </button>
            </>
          ) : (
            <>
              {step === 1 && (
                <>
                  <div className="input-group">
                    <label>Email</label>
                    <input
                      type="email"
                      placeholder="you@example.com"
                      value={form.email}
                      onChange={e => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  <div className="input-group">
                    <label>Password</label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={form.password}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                      onKeyDown={e => e.key === "Enter" && handleSendOTP()}
                    />
                  </div>

                  {error && <div className="auth-error">{error}</div>}

                  <button className="auth-btn" onClick={handleSendOTP} disabled={loading}>
                    {loading ? <AtomLoader size={22} /> : "Send OTP →"}
                  </button>

                  <button className="auth-link-btn" onClick={openForgot}>
                    Forgot password?
                  </button>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="input-group">
                    <label>Email OTP (valid 60 seconds)</label>
                    <input
                      className="otp-input"
                      type="text"
                      placeholder="••••••"
                      maxLength={6}
                      value={form.otp}
                      onChange={e => setForm({ ...form, otp: e.target.value.replace(/\D/g, "") })}
                      onKeyDown={e => e.key === "Enter" && handleVerifyOTP()}
                    />
                  </div>

                  {error && <div className="auth-error">{error}</div>}

                  <button className="auth-btn" onClick={handleVerifyOTP} disabled={loading}>
                    {loading ? <AtomLoader size={22} /> : "Verify & Login ⚡"}
                  </button>

                  <button
                    className="auth-btn ghost"
                    onClick={handleSendOTP}
                    disabled={cooldown > 0 || loading}
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend OTP"}
                  </button>

                  <button
                    className="auth-link-btn"
                    onClick={() => { setStep(1); setError(""); setForm({ ...form, otp: "" }); }}
                  >
                    ← Change email
                  </button>
                </>
              )}
            </>
          )}

          <p className="auth-switch">
            Don't have an account?{" "}
            <span onClick={goToSignup}>Sign up</span>
          </p>

          <p className="auth-seal">
            Crafted in Gold with <strong>LOVE</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
