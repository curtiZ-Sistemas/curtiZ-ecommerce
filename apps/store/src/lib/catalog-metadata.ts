import type { Metadata } from "next";

export function catalogMetadata({
  title,
  description,
  path
}: {
  title: string;
  description: string;
  path: `/${string}`;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, type: "website", url: path },
    twitter: { card: "summary", title, description }
  };
}
