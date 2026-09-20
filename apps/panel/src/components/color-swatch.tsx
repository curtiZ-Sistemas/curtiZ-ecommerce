import { productColorSwatchBackground } from "@curtiz/domain";
import type { HTMLAttributes } from "react";

export function ColorSwatch({
  name,
  primaryColor,
  secondaryColor,
  className = "",
  ...props
}: {
  name: string;
  primaryColor: string;
  secondaryColor?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">) {
  return (
    <span
      {...props}
      className={`product-color-swatch ${className}`.trim()}
      aria-label={`Cor ${name}`}
      role="img"
      style={{
        ...props.style,
        background: productColorSwatchBackground(primaryColor, secondaryColor)
      }}
    />
  );
}
