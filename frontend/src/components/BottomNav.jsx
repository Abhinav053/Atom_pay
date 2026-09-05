import "../styles/bottomnav.css";

const NAV_ITEMS = [
  { id: "dashboard", icon: "⌂", label: "Home" },
  { id: "transfer", icon: "↑", label: "Send" },
  { id: "ai", icon: "✦", label: "AI" },
  { id: "transactions", icon: "☰", label: "History" },
  { id: "settings", icon: "⚙", label: "Settings" },
];

export default function BottomNav({ active, navigate }) {
  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.map(({ id, icon, label }) => (
        <button
          key={id}
          className={`nav-item ${active === id ? "active" : ""}`}
          onClick={() => navigate(id)}
        >
          <span className="nav-icon">{icon}</span>
          <span className="nav-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}