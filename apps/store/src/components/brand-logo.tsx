import Link from "next/link";

export function BrandLogo() {
  return (
    <Link className="brand" href="/" aria-label="Curtiz — página inicial">
      <svg viewBox="0 0 210 52" role="img" aria-label="Curtiz, marca provisória">
        <title>Curtiz — identidade provisória</title>
        <text x="0" y="39" className="brand-text">
          CURTI
        </text>
        <g transform="translate(164 3)">
          <path className="brand-ring" d="M23 2a22 22 0 1 0 20 31" />
          <path className="brand-z" d="M12 13h23L13 35h24" />
        </g>
      </svg>
      <span className="sr-only">Identidade visual provisória</span>
    </Link>
  );
}
