import { usePrivacy } from '../privacy-context';
import { RedactedChunk } from './RedactedChunk';

export function PrivateSubject({ value }: { value: string }) {
  const { enabled } = usePrivacy();
  return (
    <span title={enabled ? undefined : value}>
      {!value ? '(No subject)' : !enabled ? value : value.split(/(\s+)/).map((part, index) => (
        /^\s*$/.test(part) ? part : <RedactedChunk key={index} value={part} />
      ))}
    </span>
  );
}
