import { usePrivacy } from '../privacy-context';
import { RedactedChunk } from './RedactedChunk';

function shouldKeepAddressPart(part: string, index: number, parts: string[]) {
  return part === '@' || part === '.' || (index === parts.length - 1 && parts[index - 1] === '.');
}

function redactedChunkText(value: string) {
  const characters = Array.from(value);
  const prefixLength = characters.length >= 4 ? Math.min(2, Math.floor(characters.length / 4)) : 0;
  const suffixLength = characters.length >= 4 ? 1 : 0;
  const redactionEnd = characters.length - suffixLength;

  return [
    ...characters.slice(0, prefixLength),
    ...Array(redactionEnd - prefixLength).fill('█'),
    ...characters.slice(redactionEnd),
  ].join('');
}

export function privateAddressText(value: string) {
  return value.split(/([@.])/).map((part, index, parts) => (
    shouldKeepAddressPart(part, index, parts) ? part : redactedChunkText(part)
  )).join('');
}

export function PrivateAddress({ value, fallback }: { value: string; fallback: string }) {
  const { enabled } = usePrivacy();
  if (!value) return <>{fallback}</>;
  if (!enabled) return <>{value}</>;

  return (
    <span>
      {value.split(/([@.])/).map((part, index, parts) => {
        // Keep address separators and the domain suffix readable.
        if (shouldKeepAddressPart(part, index, parts)) {
          return part;
        }

        return <RedactedChunk key={index} value={part} />;
      })}
    </span>
  );
}
