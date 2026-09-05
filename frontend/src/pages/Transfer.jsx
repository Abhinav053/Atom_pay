import { useState, useEffect, useRef } from "react";
import { api } from "../api";
import BottomNav from "../components/BottomNav";
import AtomLoader from "../components/AtomLoader";
import "../styles/transfer.css";

const QUICK_AMOUNTS = [100, 500, 1000, 2000, 5000];

export default function Transfer({ token, navigate, initialData }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    receiverUsername: initialData?.receiverUsername || "",
    amount: initialData?.amount || "",
    note: "",
    pin: ""
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(crypto.randomUUID());
  const scannerRef = useRef(null);
  const scannerInstanceRef = useRef(null);

  useEffect(() => {
    if (showScanner) {
      startScanner();
    } else {
      stopScanner();
    }
    return () => stopScanner();
  }, [showScanner]);

  const startScanner = async () => {
    const { Html5Qrcode } = await import("html5-qrcode");
    
    try {
      const html5QrCode = new Html5Qrcode("qr-reader");
      scannerInstanceRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          // Parse atompay://pay?to=username format
          try {
            const url = new URL(decodedText);
            const username = url.searchParams.get("to");
            if (username) {
              setForm(f => ({ ...f, receiverUsername: username }));
              setShowScanner(false);
            }
          } catch {
            // Could also be a direct username
            setForm(f => ({ ...f, receiverUsername: decodedText }));
            setShowScanner(false);
          }
        },
        () => {} // scan fail — ignore
      );
    } catch {
      setError("Camera access denied — enter username manually");
      setShowScanner(false);
    }
  };

  const stopScanner = async () => {
    if (scannerInstanceRef.current) {
      try {
        await scannerInstanceRef.current.stop();
        scannerInstanceRef.current.clear();
      } catch {
        // The camera may already have been stopped by the browser.
      }
      scannerInstanceRef.current = null;
    }
  };

  const handleNext = () => {
    setError("");
    if (!form.receiverUsername) return setError("Enter a username");
    if (!form.amount || Number(form.amount) < 1) return setError("Enter a valid amount");
    if (Number(form.amount) > 100000) return setError("Maximum ₹1,00,000 per transaction");
    setStep(2);
  };

  const handleTransfer = async () => {
    setError("");
    if (!form.pin || form.pin.length !== 6) return setError("Enter your 6-digit PIN");
    setLoading(true);
    try {
      await api("/transaction/transfer", {
        method: "POST",
        body: JSON.stringify({
          receiverUsername: form.receiverUsername,
          amount: Number(form.amount),
          pin: form.pin,
          note: form.note || undefined,
        }),
      }, token, {
        "Idempotency-Key": idempotencyKey
      });
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleNewTransfer = () => {
    setForm({ receiverUsername: "", amount: "", note: "", pin: "" });
    setStep(1);
    setError("");
    setIdempotencyKey(crypto.randomUUID());
  };

  const formatAmount = (n) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

  // ── Cinematic Success Screen ──
  if (step === 3) {
    return (
      <div className="success-overlay">
        {/* Confetti particles */}
        <div className="confetti-container">
          {Array.from({ length: 20 }, (_, i) => (
            <div key={i} className="confetti" />
          ))}
        </div>

        <div className="success-content">
          {/* Animated checkmark with ripple rings */}
          <div className="success-check-wrap">
            <div className="success-ripple" />
            <div className="success-ripple" />
            <div className="success-ripple" />
            <div className="success-check-circle">
              <svg className="success-check-svg" viewBox="0 0 44 44">
                <path className="check-path" d="M12 22l8 8 12-16" />
              </svg>
            </div>
          </div>

          <h2>Money Sent!</h2>
          <div className="success-amount-display">
            {formatAmount(Number(form.amount))}
          </div>
          <p className="success-recipient">
            successfully sent to <strong>@{form.receiverUsername}</strong>
          </p>

          <div className="success-actions">
            <button className="transfer-btn" onClick={handleNewTransfer}>
              Send another payment
            </button>
            <button className="transfer-btn-outline" onClick={() => navigate("dashboard")}>
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="transfer-page">
      <div className="transfer-header">
        <button className="back-btn" onClick={() => step === 2 ? setStep(1) : navigate("dashboard")}>←</button>
        <h2>{step === 1 ? "Send Money" : "Enter PIN"}</h2>
        <div />
      </div>

      {/* Step Indicator */}
      <div className="step-indicator">
        {[1, 2, 3].map(s => (
          <div key={s} className={`step-dot ${step >= s ? "active" : ""}`} />
        ))}
      </div>

      {/* QR Scanner Modal */}
      {showScanner && (
        <div className="scanner-overlay">
          <div className="scanner-modal">
            <div className="scanner-header">
              <h3>Scan QR Code</h3>
              <button className="scanner-close" onClick={() => setShowScanner(false)}>✕</button>
            </div>
            <p className="scanner-hint">Hold the receiver's QR code in front of the camera</p>
            <div id="qr-reader" ref={scannerRef} className="qr-reader-box" />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="transfer-form">
          <div className="input-group">
            <label>Who do you want to send to?</label>
            <div className="username-input-row">
              <input
                placeholder="@username"
                value={form.receiverUsername}
                onChange={e => setForm({ ...form, receiverUsername: e.target.value })}
              />
              <button
                className="scan-btn"
                onClick={() => setShowScanner(true)}
                title="Scan QR"
              >
                📷
              </button>
            </div>
          </div>

          <div className="input-group">
            <label>Amount (₹)</label>
            <input
              type="number"
              placeholder="0"
              value={form.amount}
              onChange={e => setForm({ ...form, amount: e.target.value })}
              className="amount-input"
            />
          </div>

          {/* Quick amounts */}
          <div className="quick-amounts">
            {QUICK_AMOUNTS.map(a => (
              <button
                key={a}
                className={`quick-amt-btn ${Number(form.amount) === a ? "selected" : ""}`}
                onClick={() => setForm({ ...form, amount: String(a) })}
              >
                ₹{a.toLocaleString("en-IN")}
              </button>
            ))}
          </div>

          <div className="input-group">
            <label>Note (optional)</label>
            <input
              placeholder="Rent, lunch, etc."
              value={form.note}
              onChange={e => setForm({ ...form, note: e.target.value })}
            />
          </div>

          {error && <div className="transfer-error">{error}</div>}

          <button className="transfer-btn" onClick={handleNext}>
            Review Transfer →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="transfer-form">
          <div className="transfer-summary">
            <div className="summary-row">
              <span>To</span>
              <span>@{form.receiverUsername}</span>
            </div>
            <div className="summary-row highlight">
              <span>Amount</span>
              <span>{formatAmount(Number(form.amount))}</span>
            </div>
            {form.note && (
              <div className="summary-row">
                <span>Note</span>
                <span>{form.note}</span>
              </div>
            )}
          </div>

          <div className="input-group" style={{ marginTop: 24 }}>
            <label>Confirm your UPI PIN</label>
            <input
              type="password"
              placeholder="••••••"
              maxLength={6}
              value={form.pin}
              onChange={e => setForm({ ...form, pin: e.target.value })}
            />
          </div>

          {error && <div className="transfer-error">{error}</div>}

          <button
            className={`transfer-btn ${loading ? "sending" : ""}`}
            onClick={handleTransfer}
            disabled={loading}
          >
            {loading ? <AtomLoader size={24} /> : `Confirm & Send ${formatAmount(Number(form.amount))}`}
          </button>
        </div>
      )}

      <BottomNav active="transfer" navigate={navigate} />
    </div>
  );
}
