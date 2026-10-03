import React from "react";
import { legalInlineTokens, legalMarkdownBlocks } from "@curtiz/domain";
export function LegalContent({ content, format = "plain" }: { content: string; format?: string }) {
  const inline = (text: string) =>
    legalInlineTokens(text).map((token, index) => {
      const value =
        token.bold && token.italic ? (
          <strong>
            <em>{token.text}</em>
          </strong>
        ) : token.bold ? (
          <strong>{token.text}</strong>
        ) : token.italic ? (
          <em>{token.text}</em>
        ) : (
          token.text
        );
      return token.href ? (
        <a key={index} href={token.href} target="_blank" rel="noopener noreferrer">
          {value}
        </a>
      ) : (
        <React.Fragment key={index}>{value}</React.Fragment>
      );
    });
  if (format !== "markdown")
    return (
      <>
        {content
          .split(/\n+/u)
          .filter(Boolean)
          .map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
      </>
    );
  return (
    <>
      {legalMarkdownBlocks(content).map((block, index) =>
        block.type === "heading" ? (
          <h3 key={index}>{inline(block.lines[0]!)}</h3>
        ) : block.type === "ol" ? (
          <ol key={index} start={block.start}>
            {block.lines.map((line, position) => (
              <li key={position}>{inline(line)}</li>
            ))}
          </ol>
        ) : block.type === "ul" ? (
          <ul key={index}>
            {block.lines.map((line, position) => (
              <li key={position}>{inline(line)}</li>
            ))}
          </ul>
        ) : (
          <p key={index}>{inline(block.lines[0]!)}</p>
        )
      )}
    </>
  );
}
