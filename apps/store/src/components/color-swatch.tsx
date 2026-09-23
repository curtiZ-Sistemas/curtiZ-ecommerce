import { productColorSwatchColors } from "@curtiz/domain";
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
  const colors = productColorSwatchColors(primaryColor, secondaryColor);
  return (
    <span
      {...props}
      className={`product-color-swatch ${className}`.trim()}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `Cor ${name}`}
      role={decorative ? undefined : "img"}
      style={props.style}
    >
      <i className="product-color-swatch-primary" style={{ backgroundColor: colors.primary }} />
      {colors.secondary ? <i className="product-color-swatch-secondary" style={{ backgroundColor: colors.secondary }} /> : null}
    </span>
  );
}
