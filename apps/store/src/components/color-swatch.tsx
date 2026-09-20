import { productColorSwatchBackground } from "@curtiz/domain";
import type { HTMLAttributes } from "react";

export function ColorSwatch({
  name,
  primaryColor,
  secondaryColor,
  className = "",
  decorative = false,
  ...props
}: {
  name: string;
  primaryColor: string;
  secondaryColor?: string;
  decorative?: boolean;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">) {
  return (
    <span
      {...props}
      className={`product-color-swatch ${className}`.trim()}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `Cor ${name}`}
      role={decorative ? undefined : "img"}
      style={{
        ...props.style,
        background: productColorSwatchBackground(primaryColor, secondaryColor)
      }}
    />
  );
}
