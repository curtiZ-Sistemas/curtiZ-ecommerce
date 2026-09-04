import Image from "next/image";
import Link from "next/link";

export function BrandLogo() {
  return (
    <Link className="brand" href="/" prefetch={false} aria-label="curti Z — página inicial">
      <Image
        src="/images/logo-curtiz.webp"
        alt="curti Z"
        width={336}
        height={224}
        sizes="(max-width: 700px) 138px, 168px"
      />
    </Link>
  );
}
