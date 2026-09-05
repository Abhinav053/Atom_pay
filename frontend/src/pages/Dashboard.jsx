import { useState, useEffect } from "react";
import { api } from "../api";
import BottomNav from "../components/BottomNav";
import AtomLoader from "../components/AtomLoader";
import { royalGreeting, HOST } from "../utils/royal";
import "../styles/dashboard.css";

export default function Dashboard({ token, user, navigate, onLogout }) {
  const [wallet, setWallet] = useState(null);
  const [allTxns, setAllTxns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [w, t] = await Promise.all([
          api("/wallet/balance", {}, token),
          api("/wallet/transactions", {}, token),
        ]);
        setWallet(w);
        setAllTxns(t);
      } catch (err) {
        if (err.message.includes("expired") || err.message.includes("Session expired")) onLogout();
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const recentTxns = allTxns.slice(0, 5);

  // Daily limit uses transactions from the past 24 hours
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const dailyDebitTotal = allTxns
    .filter(t => t.type === "debit" && t.status === "success" && new Date(t.createdAt).getTime() > oneDayAgo)
    .reduce((a, b) => a + b.amount, 0);

  const formatAmount = (n) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

  const formatDate = (d) =>
    new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  const displayName = user?.name || user?.username;
  const g = royalGreeting(displayName);

  if (loading) return (
    <div className="loading-screen">
      <AtomLoader size={72} royal label="Preparing your court…" />
    </div>
  );

  return (
    <div className="dashboard">

      {/* QR Modal */}
      {showQR && (
        <div className="qr-modal-overlay" onClick={() => setShowQR(false)}>
          <div className="qr-modal" onClick={e => e.stopPropagation()}>
            <div className="qr-modal-header">
              <h3>My QR Code</h3>
              <button className="qr-close-btn" onClick={() => setShowQR(false)}>✕</button>
            </div>
            <p className="qr-modal-hint">Anyone can send you money by scanning this QR code</p>
            {wallet?.qrCode ? (
              <div className="qr-image-wrap">
                <img src={wallet.qrCode} alt="My QR Code" className="qr-image" />
              </div>
            ) : (
              <div className="qr-empty">Generating QR code...</div>
            )}
            <p className="qr-username">@{user?.username}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="dash-header">
        <div>
          <p className="dash-greeting">{g.greeting}</p>
          <h2 className="dash-name">{g.first}</h2>
        </div>
        <div className="dash-avatar" onClick={() => navigate("settings")}>
          <span className="dash-avatar-crown">♛</span>
          {displayName?.[0]?.toUpperCase()}
        </div>
      </div>

      {/* Balance + Daily Limit Grid */}
      <div className="dash-top-grid">
        {/* Balance Card */}
        <div className="balance-card">
          <div className="balance-card-glow" />
          <div className="balance-top">
            <span className="balance-label">👑 Royal Treasury</span>
            <button className="eye-btn" onClick={() => setBalanceVisible(!balanceVisible)}>
              {balanceVisible ? "👁" : "🙈"}
            </button>
          </div>
          <div className="balance-amount">
            {balanceVisible ? formatAmount(wallet?.balance ?? 0) : "₹ ••••••"}
          </div>
          <div className="balance-meta">
            <span className={`wallet-status ${wallet?.status?.toLowerCase()}`}>{wallet?.status}</span>
            <span className="balance-curr">{wallet?.currency}</span>
          </div>
        </div>

        {/* Daily Limit Bar */}
        <div className="limit-bar-section">
          <div className="limit-bar-header">
            <span>Daily Limit Used</span>
            <span className="limit-bar-amt">
              {formatAmount(dailyDebitTotal)} / ₹1,00,000
            </span>
          </div>
          <div className="limit-bar-track">
            <div
              className="limit-bar-fill"
              style={{
                width: `${Math.min((dailyDebitTotal / 100000) * 100, 100)}%`
              }}
            />
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions">
        <button className="action-btn primary" onClick={() => navigate("transfer")}>
          <span className="action-icon">↑</span>
          <span>Send</span>
        </button>
        <button className="action-btn" onClick={() => navigate("topup")}>
          <span className="action-icon">↓</span>
          <span>Add Money</span>
        </button>
        <button className="action-btn" onClick={() => navigate("transactions")}>
          <span className="action-icon">☰</span>
          <span>History</span>
        </button>
        <button className="action-btn" onClick={() => setShowQR(true)}>
          <span className="action-icon">⬛</span>
          <span>My QR</span>
        </button>
        <button className="action-btn" onClick={() => navigate("settings")}>
          <span className="action-icon">⚙</span>
          <span>Settings</span>
        </button>
      </div>

      {/* Recent Transactions */}
      <div className="recent-section">
        <div className="recent-header">
          <h3>Recent Transactions</h3>
          <span onClick={() => navigate("transactions")}>View all →</span>
        </div>

        {recentTxns.length === 0 ? (
          <div className="empty-txn">
            <p>No transactions yet</p>
            <button onClick={() => navigate("transfer")}>Send your first payment ⚡</button>
          </div>
        ) : (
          recentTxns.map((tx, i) => (
            <div className="txn-item" key={i}>
              <div className={`txn-icon ${tx.type}`}>
                {tx.type === "debit" ? "↑" : "↓"}
              </div>
              <div className="txn-details">
                <span className="txn-id">
                  {tx.type === "debit" ? "To" : "From"} @{tx.peerUsername || "unknown"}
                </span>
                <span className="txn-date">{formatDate(tx.createdAt)}</span>
              </div>
              <div className={`txn-amount ${tx.type}`}>
                {tx.type === "debit" ? "-" : "+"}{formatAmount(tx.amount)}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="dash-footer">
        <span /><em>Your kingdom, curated by <strong>{HOST}</strong></em><span />
      </div>

      <div style={{ height: 80 }} />
      <BottomNav active="dashboard" navigate={navigate} />
    </div>
  );
}
