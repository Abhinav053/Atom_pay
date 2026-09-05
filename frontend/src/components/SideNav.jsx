import "../styles/sidenav.css";

const NAV_ITEMS = [
  { id: "dashboard", icon: "⌂", label: "Dashboard" },
  { id: "transfer", icon: "↑", label: "Send Money" },
  { id: "transactions", icon: "☰", label: "Transactions" },
  { id: "ai", icon: "✦", label: "AtomAI" },
  { id: "settings", icon: "⚙", label: "Settings" },
];

export default function SideNav({ active, navigate, user, onLogout }) {
  return (
    <aside className="sidenav">
      <div className="sidenav-top">
        <div className="sidenav-logo">
          <span className="sidenav-atom">⚡</span>
          <span className="sidenav-brand">AtomPay</span>
        </div>

        <div className="sidenav-user">
          <div className="sidenav-avatar">{(user?.name || user?.username)?.[0]?.toUpperCase()}</div>
          <div className="sidenav-user-info">
            <span className="sidenav-username">{user?.name || user?.username}</span>
            <span className="sidenav-role">@{user?.username}</span>
          </div>
        </div>

        <nav className="sidenav-links">
          {NAV_ITEMS.map(({ id, icon, label }) => (
            <button
              key={id}
              className={`sidenav-link ${active === id ? "active" : ""}`}
              onClick={() => navigate(id)}
            >
              <span className="sidenav-link-indicator" />
              <span className="sidenav-link-icon">{icon}</span>
              <span className="sidenav-link-label">{label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="sidenav-ornament" aria-hidden="true">
        <span className="sidenav-rule" />
        <div className="sidenav-lotus" />
        <span className="sidenav-motto">◈ Wealth, well guarded ◈</span>
        <span className="sidenav-rule" />
      </div>

      <div className="sidenav-bottom">
        <button className="sidenav-link logout-link" onClick={onLogout}>
          <span className="sidenav-link-icon">🚪</span>
          <span className="sidenav-link-label">Logout</span>
        </button>
        <div className="sidenav-credit">Crafted by <strong>Akshay Dhankhar</strong></div>
      </div>
    </aside>
  );
}
