import { useEffect, useRef, useState } from "react";
import { overflows } from "./scroll";
import type { ScrollAxis } from "./scroll";

/** Whether the element currently overflows on the axis; re-measured when the element or its children resize. Without ResizeObserver it is measured once. */
export function useOverflow<T extends HTMLElement>(axis: ScrollAxis) {
  const ref = useRef<T>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => setScrolls(overflows(element, axis));
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [axis]);
  return { ref, scrolls };
}
