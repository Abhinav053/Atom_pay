import { useState, useEffect } from "react";
import { api } from "../api";
import BottomNav from "../components/BottomNav";
import AtomLoader from "../components/AtomLoader";
import "../styles/transactions.css";

export default function Transactions({ token, navigate }) {
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    api("/wallet/transactions", {}, token)
      .then(setTxns)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = txns.filter(tx => {
    if (filter === "all") return true;
    if (filter === "debit") return tx.type === "debit";
    if (filter === "credit") return tx.type === "credit";
    if (filter === "failed") return tx.status === "failed";
    return true;
  });

  const formatAmount = (n) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

  const formatDate = (d) =>
    new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const totalSent = txns.filter(t => t.type === "debit" && t.status === "success").reduce((a, b) => a + b.amount, 0);
  const totalReceived = txns.filter(t => t.type === "credit" && t.status === "success").reduce((a, b) => a + b.amount, 0);

  const handlePayAgain = (tx) => {
    navigate("transfer", {
      receiverUsername: tx.peerUsername,
      amount: String(tx.amount)
    });
  };

  return (
    <div className="txn-page">
      <div className="txn-header">
        <button className="back-btn" onClick={() => navigate("dashboard")}>←</button>
        <h2>Royal Ledger</h2>
        <div />
      </div>

      {/* Summary */}
      <div className="txn-summary">
        <div className="txn-summary-card sent">
          <span className="summary-label">Total Sent</span>
          <span className="summary-val">{formatAmount(totalSent)}</span>
        </div>
        <div className="txn-summary-card received">
          <span className="summary-label">Total Received</span>
          <span className="summary-val">{formatAmount(totalReceived)}</span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="filter-tabs">
        {["all", "debit", "credit", "failed"].map(f => (
          <button
            key={f}
            className={`filter-tab ${filter === f ? "active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-screen"><AtomLoader size={64} label="Loading transactions…" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-txn">
          <p>No transactions found</p>
        </div>
      ) : (
        <div className="txn-list">
          {filtered.map((tx, i) => (
            <div className="txn-card" key={i}>
              <div className={`txn-icon-lg ${tx.type}`}>
                {tx.type === "debit" ? "↑" : "↓"}
              </div>
              <div className="txn-info">
                <div className="txn-top-row">
                  <span className="txn-peer-name">
                    {tx.type === "debit" ? "To" : "From"}{" "}
                    <strong>@{tx.peerUsername || "unknown"}</strong>
                  </span>
                  <span className={`txn-amount-lg ${tx.type}`}>
                    {tx.type === "debit" ? "-" : "+"}{formatAmount(tx.amount)}
                  </span>
                </div>
                {tx.note && (
                  <div className="txn-note-row">
                    <span className="txn-note">💬 {tx.note}</span>
                  </div>
                )}
                <div className="txn-bottom-row">
                  <span className="txn-date-full">{formatDate(tx.createdAt)}</span>
                  <span className={`txn-status-badge ${tx.status}`}>{tx.status}</span>
                </div>
                {/* Pay Again button — only for successful debit transactions */}
                {tx.type === "debit" && tx.status === "success" && tx.peerUsername && (
                  <button
                    className="pay-again-btn"
                    onClick={() => handlePayAgain(tx)}
                  >
                    ↑ Pay Again
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ height: 80 }} />
      <BottomNav active="transactions" navigate={navigate} />
    </div>
  );
}
