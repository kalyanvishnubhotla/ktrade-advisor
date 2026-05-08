import { useCallback, useEffect, useRef, useState } from 'react';

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const TICK_MS = 1000; // countdown updates every second

function isMarketOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat

  // Skip weekends
  if (day === 0 || day === 6) return false;

  // US Eastern Time offset: EST = UTC-5, EDT = UTC-4
  // Simple DST approximation: second Sunday March → first Sunday November
  const year = now.getUTCFullYear();
  const dstStart = new Date(Date.UTC(year, 2, 8)); // start of March 8-14 window
  dstStart.setUTCDate(8 + ((7 - dstStart.getUTCDay()) % 7)); // second Sunday in March
  const dstEnd = new Date(Date.UTC(year, 10, 1)); // start of November 1-7 window
  dstEnd.setUTCDate(1 + ((7 - dstEnd.getUTCDay()) % 7)); // first Sunday in November

  const isDST = now >= dstStart && now < dstEnd;
  const etOffsetMinutes = isDST ? -4 * 60 : -5 * 60;

  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const etMinutes = utcMinutes + etOffsetMinutes;

  // Market hours: 9:30 AM – 4:00 PM ET
  return etMinutes >= 9 * 60 + 30 && etMinutes < 16 * 60;
}

export function useAutoRefresh(onRefresh: () => Promise<void>) {
  const [marketOpen, setMarketOpen] = useState(isMarketOpen());
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(REFRESH_INTERVAL_MS / 1000);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(REFRESH_INTERVAL_MS / 1000);

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    secondsRef.current = REFRESH_INTERVAL_MS / 1000;
    setSecondsUntilRefresh(secondsRef.current);

    // Countdown tick
    countdownRef.current = setInterval(() => {
      secondsRef.current -= 1;
      setSecondsUntilRefresh(secondsRef.current);
    }, TICK_MS);

    // Actual refresh
    timerRef.current = setTimeout(async () => {
      const open = isMarketOpen();
      setMarketOpen(open);
      if (open) {
        await onRefresh();
        setLastRefreshed(new Date());
      }
      scheduleNext();
    }, REFRESH_INTERVAL_MS);
  }, [onRefresh]);

  // Check market status every minute
  useEffect(() => {
    const marketCheck = setInterval(() => {
      setMarketOpen(isMarketOpen());
    }, 60_000);
    return () => clearInterval(marketCheck);
  }, []);

  // Start the auto-refresh loop on mount
  useEffect(() => {
    scheduleNext();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [scheduleNext]);

  const formatCountdown = () => {
    const s = Math.max(0, Math.round(secondsUntilRefresh));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, '0')}`;
  };

  return { marketOpen, secondsUntilRefresh, lastRefreshed, formatCountdown };
}
