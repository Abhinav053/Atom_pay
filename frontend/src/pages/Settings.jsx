import { useState } from "react";
import { api } from "../api";
import BottomNav from "../components/BottomNav";
import AtomLoader from "../components/AtomLoader";
import { honorificFor, HOST } from "../utils/royal";
import "../styles/settings.css";

export default function Settings({ token, user, navigate, onLogout }) {
  const [activePanel, setActivePanel] = useState(null);
  const [form, setForm] = useState({});
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => { setForm({}); setMsg(""); setError(""); };

  const openPanel = (p) => { setActivePanel(p); reset(); };

  const handleChangePassword = async () => {
    setError(""); setMsg("");
    if (!form.oldPassword || !form.newPassword) return setError("Fill all fields");
    setLoading(true);
    try {
      const d = await api("/auth/change-password", {
        method: "PATCH",
        body: JSON.stringify(form),
      }, token);
      setMsg(d.msg);
      setForm({});
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleChangePin = async () => {
    setError(""); setMsg("");
    if (!form.oldPin || !form.newPin) return setError("Fill all fields");
    setLoading(true);
    try {
      const d = await api("/auth/change-pin", {
        method: "PATCH",
        body: JSON.stringify(form),
      }, token);
      setMsg(d.msg);
      setForm({});
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="back-btn" onClick={() => navigate("dashboard")}>←</button>
        <h2>Settings</h2>
        <div />
      </div>

      {/* Profile Card */}
      <div className="profile-card">
        <div className="profile-avatar">
          <span className="profile-crown">♛</span>
          {user?.username?.[0]?.toUpperCase()}
        </div>
        <div className="profile-info">
          <span className="profile-honorific">{honorificFor(user?.username)}</span>
          <h3>{user?.username}</h3>
          <span className="profile-role">{user?.role}</span>
        </div>
      </div>

      {/* Settings List */}
      <div className="settings-list">
        <button className="setting-item" onClick={() => openPanel("password")}>
          <span className="setting-icon">🔒</span>
          <span className="setting-label">Change Password</span>
          <span className="setting-arrow">→</span>
        </button>
        <button className="setting-item" onClick={() => openPanel("pin")}>
          <span className="setting-icon">🔑</span>
          <span className="setting-label">Change UPI PIN</span>
          <span className="setting-arrow">→</span>
        </button>
        <button className="setting-item danger" onClick={onLogout}>
          <span className="setting-icon">🚪</span>
          <span className="setting-label">Logout</span>
          <span className="setting-arrow">→</span>
        </button>
      </div>

      {/* Change Password Panel */}
      {activePanel === "password" && (
        <div className="settings-panel-overlay" onClick={() => setActivePanel(null)}>
          <div className="settings-panel" onClick={e => e.stopPropagation()}>
            <h3>Change Password</h3>
            <div className="input-group">
              <label>Old Password</label>
              <input type="password" placeholder="Current password" value={form.oldPassword || ""}
                onChange={e => setForm({ ...form, oldPassword: e.target.value })} />
            </div>
            <div className="input-group">
              <label>New Password</label>
              <input type="password" placeholder="Min 8 characters" value={form.newPassword || ""}
                onChange={e => setForm({ ...form, newPassword: e.target.value })} />
            </div>
            {error && <div className="panel-error">{error}</div>}
            {msg && <div className="panel-success">{msg}</div>}
            <button className="panel-btn" onClick={handleChangePassword} disabled={loading}>
              {loading ? <AtomLoader size={22} /> : "Update Password"}
            </button>
            <button className="panel-btn-cancel" onClick={() => setActivePanel(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Change PIN Panel */}
      {activePanel === "pin" && (
        <div className="settings-panel-overlay" onClick={() => setActivePanel(null)}>
          <div className="settings-panel" onClick={e => e.stopPropagation()}>
            <h3>Change UPI PIN</h3>
            <div className="input-group">
              <label>Old PIN</label>
              <input type="password" placeholder="••••••" maxLength={6} value={form.oldPin || ""}
                onChange={e => setForm({ ...form, oldPin: e.target.value })} />
            </div>
            <div className="input-group">
              <label>New PIN</label>
              <input type="password" placeholder="••••••" maxLength={6} value={form.newPin || ""}
                onChange={e => setForm({ ...form, newPin: e.target.value })} />
            </div>
            {error && <div className="panel-error">{error}</div>}
            {msg && <div className="panel-success">{msg}</div>}
            <button className="panel-btn" onClick={handleChangePin} disabled={loading}>
              {loading ? <AtomLoader size={22} /> : "Update PIN"}
            </button>
            <button className="panel-btn-cancel" onClick={() => setActivePanel(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="settings-footer">
        <span /><em>At your service — <strong>{HOST}</strong></em><span />
      </div>

      <div style={{ height: 80 }} />
      <BottomNav active="settings" navigate={navigate} />
    </div>
  );
}