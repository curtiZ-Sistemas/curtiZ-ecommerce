"use client";

import { type ComponentProps, useEffect, useRef, useState } from "react";
import { formatPostalCode } from "@/lib/personal-data";
import { createPostalCodeLookup, type PostalAddress } from "@/lib/postal-code-lookup";

type Props = ComponentProps<"input"> & { lookupInitial?: boolean; replaceUntouchedOnChange?: boolean };

export function PostalCodeInput({ lookupInitial = false, replaceUntouchedOnChange = false, onInput, ...props }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lookupRef = useRef<ReturnType<typeof createPostalCodeLookup> | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const lookup = createPostalCodeLookup(() => {
      const form = inputRef.current?.form;
      const field = (name: string) => {
        const element = form?.elements.namedItem(name);
        return element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element : undefined;
      };
      return { street: field("street"), district: field("district"), city: field("city"), state: field("state") };
    }, (result) => setStatus({ idle: "", loading: "Buscando endereço…", found: "Endereço encontrado. Confira os dados.",
      partial: "CEP encontrado. Complete os campos que faltam.", missing: "CEP não encontrado. Preencha o endereço manualmente.",
      unavailable: "Não foi possível buscar o CEP. Preencha o endereço manualmente." }[result]),
      { initialCode: inputRef.current?.value, replaceUntouchedOnChange });
    lookupRef.current = lookup;
    const form = inputRef.current?.form;
    const markEdited = (event: Event) => {
      const target = event.target;
      if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement)
        && ["street", "district", "city", "state"].includes(target.name)) lookup.markEdited(target.name as keyof PostalAddress);
    };
    form?.addEventListener("input", markEdited);
    form?.addEventListener("change", markEdited);
    if (lookupInitial && inputRef.current?.value) void lookup.update(inputRef.current.value);
    return () => { form?.removeEventListener("input", markEdited); form?.removeEventListener("change", markEdited);
      lookup.dispose(); lookupRef.current = null; };
  }, [lookupInitial, replaceUntouchedOnChange]);
  return <>
    <input {...props} ref={inputRef} onInput={(event) => {
      event.currentTarget.value = formatPostalCode(event.currentTarget.value);
      onInput?.(event);
      void lookupRef.current?.update(event.currentTarget.value);
    }} />
    {status && <span role="status" aria-live="polite">{status}</span>}
  </>;
}
