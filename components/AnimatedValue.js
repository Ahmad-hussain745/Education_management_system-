"use client";

import { useEffect, useRef, useState } from "react";

// Counts a formatted stat value up from zero on mount — "Rs. 45,000",
// "85.3%", or a plain "1,204" all work the same way: pull the prefix,
// number, and suffix apart with one regex, animate just the number, then
// glue the same prefix/suffix back on every frame. Ends by snapping to the
// exact original string, so there's never any float-rounding drift between
// what animates in and what every other page/report shows for this same
// figure. Skips straight to the final value for anything that isn't a
// number-shaped string (e.g. the "—" shown for null attendance) and for
// anyone with prefers-reduced-motion set.
export default function AnimatedValue({ value, duration = 800 }) {
  const [display, setDisplay] = useState(value);
  const frameRef = useRef(null);

  useEffect(() => {
    const match = String(value).match(/^(.*?)(-?[\d,]+(?:\.\d+)?)(.*)$/);
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!match || reduceMotion) {
      setDisplay(value);
      return undefined;
    }

    const [, prefix, numStr, suffix] = match;
    const target = parseFloat(numStr.replace(/,/g, ""));
    const decimals = numStr.includes(".") ? numStr.split(".")[1].length : 0;
    const hasCommas = numStr.includes(",");

    const formatNum = (n) =>
      hasCommas
        ? n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
        : n.toFixed(decimals);

    const start = performance.now();

    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic — quick start, gentle settle
      setDisplay(`${prefix}${formatNum(target * eased)}${suffix}`);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(value); // exact original string, no float drift
      }
    }

    setDisplay(`${prefix}${formatNum(0)}${suffix}`);
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [value, duration]);

  return <>{display}</>;
}
