import { useEffect, useRef } from "react";
import AtomLoader from "./AtomLoader";
import "../styles/welcome.css";

/**
 * RoyalWelcome — the unforgettable "palace gate" coronation moment shown
 * the instant a guest is authenticated, just before the kingdom (dashboard)
 * opens.
 *
 * It is deliberately personal: every guest is greeted by name, and by their
 * host, Akshay Dhankhar — a coronation for first-time sovereigns, a royal
 * homecoming for returning ones.
 *
 * @param {string}   name       the guest's name (or username)
 * @param {boolean}  isNewUser  true on first-ever signup → coronation
 * @param {function} onEnter    called when the guest enters the kingdom
 * @param {string}   host       the host's name (default: Akshay Dhankhar)
 */
const HOST = "Akshay Dhankhar";

export default function RoyalWelcome({ name, isNewUser, onEnter, host = HOST }) {
  const btnRef = useRef(null);

  // First name only — feels more personal than a full name or handle.
  const firstName = (name || "Guest").trim().split(/\s+/)[0];

  useEffect(() => {
    // Let the guest press Enter to enter their kingdom.
    const onKey = (e) => { if (e.key === "Enter") onEnter?.(); };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => btnRef.current?.focus(), 1800);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(t); };
  }, [onEnter]);

  return (
    <div className="royal-welcome">
      {/* Radiant gold throne-light sweeping the hall */}
      <div className="rw-rays" />

      {/* Falling gold dust */}
      <div className="rw-dust" aria-hidden="true">
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} className={`rw-mote rw-mote-${(i % 8) + 1}`} />
        ))}
      </div>

      <div className="rw-content">
        {/* Royal crest — gold atom under an ornamental crown */}
        <div className="rw-crest">
          <div className="rw-crown">♛</div>
          <AtomLoader size={96} royal />
        </div>

        <div className="rw-eyebrow">
          {isNewUser ? "By Royal Decree — A New Reign Begins" : "The Court Has Awaited You"}
        </div>

        <h1 className="rw-name">{firstName}</h1>

        <div className="rw-divider" aria-hidden="true">
          <span /><i>❖</i><span />
        </div>

        <p className="rw-message">
          {isNewUser ? (
            <>
              Your treasury is open and your seal is struck. The royal court of
              <strong> AtomPay</strong> bows to its newest sovereign — and
              <strong> ₹5,00,000</strong> has been placed in your treasury to begin your reign.
            </>
          ) : (
            <>
              Your kingdom stands exactly as you left it — every coin counted,
              every gate guarded. Welcome home, <strong>Your Majesty</strong>.
            </>
          )}
        </p>

        {/* The host personally receives every guest */}
        <div className="rw-host">
          <span className="rw-host-line" />
          <span className="rw-host-text">
            {isNewUser
              ? <>Personally crowned by <strong>{host}</strong></>
              : <>The gates reopened for you by <strong>{host}</strong></>}
          </span>
          <span className="rw-host-line" />
        </div>

        <button ref={btnRef} className="rw-enter" onClick={() => onEnter?.()}>
          <span>{isNewUser ? "Enter your kingdom" : "Return to your throne"}</span>
          <i>→</i>
        </button>

        <div className="rw-seal" title={`Crafted by ${host}`}>
          Crafted in gold by <strong>{host}</strong>
        </div>
      </div>
    </div>
  );
}
