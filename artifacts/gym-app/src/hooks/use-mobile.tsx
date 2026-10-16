import * as React from "react"

/** Phones: below Tailwind's `md` breakpoint. */
export const MOBILE_BREAKPOINT = 768
/** Phones and tablets (iPad portrait/landscape mini): below Tailwind's `lg` breakpoint. */
export const TABLET_BREAKPOINT = 1024

function useMaxWidth(breakpoint: number) {
  const [matches, setMatches] = React.useState<boolean>(() =>
    typeof window === "undefined" ? false : window.innerWidth < breakpoint,
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const onChange = () => setMatches(mql.matches)
    mql.addEventListener("change", onChange)
    setMatches(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [breakpoint])

  return matches
}

/** True on phones (< 768px). */
export function useIsMobile() {
  return useMaxWidth(MOBILE_BREAKPOINT)
}

/** True on phones and tablets (< 1024px), where the sidebar is a rail/overlay. */
export function useIsBelowDesktop() {
  return useMaxWidth(TABLET_BREAKPOINT)
}
