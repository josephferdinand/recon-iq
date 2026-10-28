import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Temporarily reveals a password field for a fixed duration.
 * - Click shows plaintext for `durationMs` then auto-hides.
 * - Second click while visible hides immediately and clears timer.
 * - Timer is cleared on unmount.
 */
export function usePasswordPeek(durationMs = 3000) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const toggle = useCallback(() => {
    if (visible) {
      clearTimer();
      setVisible(false);
      return;
    }
    setVisible(true);
    clearTimer();
    timerRef.current = setTimeout(() => {
      setVisible(false);
      timerRef.current = null;
    }, durationMs);
  }, [visible, durationMs, clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const type: "text" | "password" = visible ? "text" : "password";
  return {
    visible,
    toggle,
    type,
  };
}
