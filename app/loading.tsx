export default function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', gap: '20px' }}>
      <div className="clapperboard">
        <div className="clapperboard-top">
          <div className="stripes"></div>
        </div>
        <div className="clapperboard-bottom">
          <div className="stripes"></div>
        </div>
      </div>
      <div style={{ color: 'var(--gold)', fontSize: '1.5rem', fontWeight: 600, letterSpacing: '2px', animation: 'pulse 1.5s infinite' }}>
        LUCES, CÁMARA, ACCIÓN... 🎬
      </div>
    </div>
  );
}
