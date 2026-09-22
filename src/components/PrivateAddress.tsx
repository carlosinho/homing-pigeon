import { usePrivacy } from '../privacy-context';
import { RedactedChunk } from './RedactedChunk';

export function PrivateAddress({ value, fallback }: { value: string; fallback: string }) {
  const { enabled } = usePrivacy();
  if (!value) return <>{fallback}</>;
  if (!enabled) return <>{value}</>;

  return (
    <span>
      {value.split(/([@.])/).map((part, index, parts) => {
        // Keep address separators and the domain suffix readable.
        if (part === '@' || part === '.' || (index === parts.length - 1 && parts[index - 1] === '.')) {
          return part;
        }

        return <RedactedChunk key={index} value={part} />;
      })}
    </span>
  );
}
