import React, { useState } from 'react';
import { Moon } from 'lucide-react';
import { api } from '../../services/api';
import { useVisiblePolling } from '../../lib/useVisiblePolling';

/** NASA renders a frame an hour; checking twice an hour keeps the picture within half an hour of true. */
const REFRESH_MS = 30 * 60_000;
/**
 * How far the frame is scaled up so the disc fills the circle: NASA's disc
 * takes about 87% of its square frame, and a touch less than that is filled so
 * the limb is never cut, even with the moon at its closest.
 */
const FRAME_SCALE = '112%';

/**
 * The moon as it looks this hour: NASA's Dial-A-Moon rendering (public
 * domain), with its true phase and tilt, cropped to a circle so the black sky
 * around it disappears on every theme. South of the equator NASA's south-up
 * picture is used, which is how the moon looks from there.
 */
export const MoonPhoto: React.FC<{ southern: boolean; className: string }> = ({ southern, className }) => {
  const [urls, setUrls] = useState<{ north: string; south: string } | null>(null);
  const [broken, setBroken] = useState(false);

  useVisiblePolling(() => {
    api.moonImage().then(u => { setUrls(u); setBroken(false); }).catch(() => setUrls(null));
  }, REFRESH_MS);

  const src = urls ? (southern ? urls.south : urls.north) : null;

  return (
    <div className={`relative rounded-full overflow-hidden bg-[#050608] ${className}`}>
      {src && !broken ? (
        <img
          src={src}
          alt="The moon as it looks this hour"
          onError={() => setBroken(true)}
          className="absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 select-none"
          style={{ width: FRAME_SCALE, height: FRAME_SCALE }}
          draggable={false}
        />
      ) : (
        <Moon className="absolute inset-0 m-auto w-1/2 h-1/2 text-ink-4" aria-hidden="true" />
      )}
    </div>
  );
};
