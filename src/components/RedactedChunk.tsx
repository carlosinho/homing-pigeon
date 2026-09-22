export function RedactedChunk({ value }: { value: string }) {
  const characters = Array.from(value);
  const prefixLength = characters.length >= 4 ? Math.min(2, Math.floor(characters.length / 4)) : 0;
  const suffixLength = characters.length >= 4 ? 1 : 0;
  const redactionEnd = characters.length - suffixLength;

  return (
    <span>
      {characters.slice(0, prefixLength).join('')}
      <span className="redacted-chunk">{characters.slice(prefixLength, redactionEnd).join('')}</span>
      {characters.slice(redactionEnd).join('')}
    </span>
  );
}
