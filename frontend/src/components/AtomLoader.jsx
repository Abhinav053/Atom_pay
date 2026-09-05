/**
 * AtomLoader — the signature AtomPay loading animation.
 *
 * A regal gold atom: a breathing molten-gold nucleus circled by a slow
 * rotating gold aura (a royal chakra/sunburst), with three 3D-tilted
 * orbits whose gold electrons trail comet glows. The crown variant adds
 * an extra ornamental sweep for the grand entrance / coronation moments.
 *
 * Styles live in global.css.
 *
 * @param {number}  size   diameter in px (default 64)
 * @param {string}  label  optional caption shown under the atom
 * @param {boolean} royal  enable the gold-crown variant (entrance/welcome)
 */
export default function AtomLoader({ size = 64, label, royal = false }) {
  return (
    <div className={`atom-loader${royal ? " royal" : ""}`} style={{ "--atom-size": `${size}px` }}>
      <div className="atom" role="status" aria-label="loading">
        <div className="atom-aura" />
        <div className="atom-nucleus" />
        <div className="ring ring-outer">
          <span className="e-wrap"><span className="electron" /></span>
        </div>
        <div className="ring ring-middle">
          <span className="e-wrap"><span className="electron" /></span>
        </div>
        <div className="ring ring-inner">
          <span className="e-wrap"><span className="electron" /></span>
        </div>
      </div>
      {label && <span className="atom-loader-label">{label}</span>}
    </div>
  );
}
