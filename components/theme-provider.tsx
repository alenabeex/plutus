"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

// Plutus is a light-only product — every view uses hardcoded light hex
// (INK/MUTED/white cards). forcedTheme="light" pins <html> so the OS dark
// setting can never flip shadcn's --card/--background vars to their dark
// values (which rendered var(--card) buttons black). No user theme toggle.
function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      forcedTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}

export { ThemeProvider }
