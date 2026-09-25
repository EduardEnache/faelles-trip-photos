/**
 * app root: session gate (PIN → Who → shell) then the shell.
 * "Switch person" reuses the Who screen as a full-screen takeover on top of
 * the ready state (choosingPerson), without losing library/route state.
 */
import { useEffect } from 'react';
import { useSession } from '@/state/session';
import { useLibrary } from '@/state/library';
import { PinGate } from '@/features/auth/PinGate';
import { WhoScreen } from '@/features/auth/WhoScreen';
import { Shell } from './Shell';

export default function Root() {
  const status = useSession((s) => s.status);
  const choosingPerson = useSession((s) => s.choosingPerson);
  const refresh = useSession((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (status !== 'ready') return;
    void useLibrary.getState().load();
    return useLibrary.getState().startLive();
  }, [status]);

  if (status === 'unknown') {
    return <div aria-hidden="true" style={{ minHeight: '100dvh', background: 'var(--kalk)' }} />;
  }
  if (status === 'locked') return <PinGate />;
  if (status === 'needs-person' || choosingPerson) {
    return <WhoScreen mode={status === 'needs-person' ? 'first' : 'change'} />;
  }
  return <Shell />;
}
