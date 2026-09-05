import AtomLoader from "../components/AtomLoader";
import "../styles/maintenance.css";

export default function Maintenance() {
  return (
    <div className="maintenance-page">
      <div className="maintenance-bg">
        <div className="maintenance-orb orb-1" />
        <div className="maintenance-orb orb-2" />
        <div className="maintenance-orb orb-3" />
      </div>

      <div className="maintenance-content">
        <div className="maintenance-icon">
          <AtomLoader size={104} />
        </div>

        <h1 className="maintenance-title">Under Maintenance</h1>
        <p className="maintenance-desc">
          Akshay Dhankhar is upgrading AtomPay to serve you better.<br />
          This won't take long — hang tight!
        </p>

        <div className="maintenance-status">
          <span className="status-dot" />
          <span>Systems are being updated</span>
        </div>

        <div className="maintenance-eta">
          <div className="eta-item">
            <span className="eta-icon">🔒</span>
            <span>Your funds are safe</span>
          </div>
          <div className="eta-item">
            <span className="eta-icon">🔔</span>
            <span>We'll be back shortly</span>
          </div>
          <div className="eta-item">
            <span className="eta-icon">⚡</span>
            <span>Faster & more reliable</span>
          </div>
        </div>
      </div>

      <p className="maintenance-footer">
        AtomPay — India's Lightning-Fast Payment Wallet
      </p>
    </div>
  );
}
