import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import BottomNav from "../components/BottomNav";
import AtomLoader from "../components/AtomLoader";
import "../styles/transfer.css";

const QUICK_AMOUNTS = [100, 500, 1000, 2000, 5000];
const TERMINAL_STATES = new Set(["SUCCESS", "FAILED"]);

export default function Topup({ token, navigate }) {
  const [amount, setAmount] = useState("");
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!payment || TERMINAL_STATES.has(payment.status)) return undefined;

    const poll = async () => {
      try {
        const latest = await api(`/wallet/topup/${payment.paymentId}`, {}, token);
        setPayment(latest);
      } catch (err) {
        setError(err.message);
      }
    };

    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [payment?.paymentId, payment?.status, token]);

  const startTopup = async () => {
    const numericAmount = Number(amount);
    setError("");
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Enter a valid top-up amount");
      return;
    }

    setLoading(true);
    try {
      const result = await api("/wallet/topup", {
        method: "POST",
        body: JSON.stringify({ amount: numericAmount }),
      }, token, { "Idempotency-Key": idempotencyKey.current });
      setPayment(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setAmount("");
    setPayment(null);
    setError("");
    idempotencyKey.current = crypto.randomUUID();
  };

  const formatAmount = (value) => new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  }).format(value || 0);

  return (
    <div className="transfer-page">
      <div className="transfer-header">
        <button className="back-btn" onClick={() => navigate("dashboard")}>←</button>
        <h2>Add Money</h2>
        <div />
      </div>

      {!payment ? (
        <div className="transfer-form">
          <div className="transfer-hero"><span className="transfer-hero-icon">↓</span><h3>Top up your wallet</h3><p>Funds are processed securely by AtomPay.</p></div>
          <div className="input-group"><label>Amount (₹)</label><input type="number" min="1" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="amount-input" /></div>
          <div className="quick-amounts">{QUICK_AMOUNTS.map((value) => <button key={value} className={`quick-amt-btn ${Number(amount) === value ? "selected" : ""}`} onClick={() => setAmount(String(value))}>₹{value.toLocaleString("en-IN")}</button>)}</div>
          {error && <div className="transfer-error">{error}</div>}
          <button className="transfer-btn" onClick={startTopup} disabled={loading}>{loading ? <AtomLoader size={24} /> : `Add ${formatAmount(Number(amount))}`}</button>
        </div>
      ) : (
        <div className="transfer-form">
          <div className="transfer-summary">
            <div className="summary-row"><span>Amount</span><span>{formatAmount(payment.amount || Number(amount))}</span></div>
            <div className="summary-row highlight"><span>Status</span><span>{payment.status}</span></div>
          </div>
          {!TERMINAL_STATES.has(payment.status) && <p className="transfer-hint">Processing your payment… this usually takes a few seconds.</p>}
          {payment.status === "SUCCESS" && <><div className="panel-success">Money added successfully.</div><button className="transfer-btn" onClick={() => navigate("dashboard")}>View wallet</button></>}
          {payment.status === "FAILED" && <><div className="transfer-error">{payment.failureReason || "Top-up failed. Please try again."}</div><button className="transfer-btn" onClick={reset}>Try again</button></>}
          {error && <div className="transfer-error">{error}</div>}
        </div>
      )}
      <BottomNav active="dashboard" navigate={navigate} />
    </div>
  );
}
