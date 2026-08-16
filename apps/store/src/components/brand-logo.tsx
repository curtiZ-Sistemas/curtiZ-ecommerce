import Image from "next/image";
import Link from "next/link";

export function BrandLogo({ priority = false }: { priority?: boolean }) {
  return (
    <Link className="brand" href="/" aria-label="curti Z — página inicial">
      <Image
        src="/images/logo-curtiz.png"
        alt="curti Z"
        width={420}
        height={120}
        priority={priority}
      />
    </Link>
  );
}
