/**
 * Waveform visualizer component.
 * Shows animated bars during recording based on audio level.
 */
import { useMemo } from 'react';

const BAR_COUNT = 18;

export default function Waveform({ isActive, audioLevel = 0 }) {
  const bars = useMemo(
    () => Array.from({ length: BAR_COUNT }, (_, i) => i),
    []
  );

  if (!isActive) {
    return (
      <div className="waveform-container" aria-hidden="true">
        {bars.map((i) => (
          <div
            key={i}
            className="waveform-bar"
            style={{ height: '4px', opacity: 0.2 }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="waveform-container" aria-hidden="true" role="presentation">
      {bars.map((i) => {
        // Create a ripple effect from the center bars outward
        const center = (BAR_COUNT - 1) / 2;
        const distFromCenter = Math.abs(i - center) / center;
        const falloff = 1 - distFromCenter * 0.5;
        const noise = Math.sin(i * 2.1 + Date.now() / 100) * 0.3 + 0.7;
        const heightPct = Math.max(0.1, audioLevel * falloff * noise);
        const height = 6 + heightPct * 28;

        return (
          <div
            key={i}
            className="waveform-bar animate"
            style={{
              height: `${height}px`,
              animationDelay: `${(i % 5) * 0.08}s`,
              opacity: 0.5 + audioLevel * 0.5,
            }}
          />
        );
      })}
    </div>
  );
}
