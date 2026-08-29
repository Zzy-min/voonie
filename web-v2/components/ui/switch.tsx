"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex shrink-0 items-center rounded-full transition-all outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-[#d9845b] disabled:cursor-not-allowed disabled:opacity-50",
        size === "default" ? "w-12 h-7" : "w-9 h-5",
        "data-[state=checked]:bg-[#d9845b] data-[state=checked]:border-[#c3552f]",
        "data-[state=unchecked]:bg-[#ebd6cb] data-[state=unchecked]:border-[#d5b5a4]",
        "border shadow-inner",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow-md ring-0 transition-transform",
          size === "default" ? "size-5" : "size-3.5",
          size === "default"
            ? "data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-[3px]"
            : "data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-[2px]"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }

