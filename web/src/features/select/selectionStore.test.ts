import { beforeEach, describe, expect, it } from 'vitest';
import { useSelection } from './selectionStore';

function reset() {
  useSelection.setState({ active: false, ids: [], lastIndex: null });
}

describe('selectionStore', () => {
  beforeEach(reset);

  it('enter() activates select mode with one id', () => {
    useSelection.getState().enter('a');
    expect(useSelection.getState().active).toBe(true);
    expect(useSelection.getState().ids).toEqual(['a']);
  });

  it('enterEmpty() activates select mode with nothing selected', () => {
    useSelection.getState().enterEmpty();
    expect(useSelection.getState().active).toBe(true);
    expect(useSelection.getState().ids).toEqual([]);
  });

  it('toggle() adds then removes', () => {
    useSelection.getState().enterEmpty();
    useSelection.getState().toggle('a');
    expect(useSelection.getState().ids).toEqual(['a']);
    useSelection.getState().toggle('a');
    expect(useSelection.getState().ids).toEqual([]);
  });

  it('exit() clears everything', () => {
    useSelection.getState().enter('a');
    useSelection.getState().exit();
    expect(useSelection.getState()).toMatchObject({ active: false, ids: [] });
  });

  it('selectRange() selects an inclusive range regardless of direction', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    useSelection.getState().enterEmpty();
    useSelection.getState().selectRange(ids, 1, 3);
    expect(new Set(useSelection.getState().ids)).toEqual(new Set(['b', 'c', 'd']));

    reset();
    useSelection.getState().enterEmpty();
    useSelection.getState().selectRange(ids, 3, 1); // reversed
    expect(new Set(useSelection.getState().ids)).toEqual(new Set(['b', 'c', 'd']));
  });

  it('selectRange() merges with an existing selection instead of replacing it', () => {
    useSelection.getState().enterEmpty();
    useSelection.getState().toggle('e');
    useSelection.getState().selectRange(['a', 'b', 'c', 'd', 'e'], 0, 1);
    expect(new Set(useSelection.getState().ids)).toEqual(new Set(['a', 'b', 'e']));
  });

  it('setMany() adds or removes a batch (per-day select)', () => {
    useSelection.getState().enterEmpty();
    useSelection.getState().setMany(['a', 'b'], true);
    expect(new Set(useSelection.getState().ids)).toEqual(new Set(['a', 'b']));
    useSelection.getState().setMany(['a'], false);
    expect(useSelection.getState().ids).toEqual(['b']);
  });

  it('selectAll() replaces the selection with the given ids', () => {
    useSelection.getState().enterEmpty();
    useSelection.getState().toggle('z');
    useSelection.getState().selectAll(['a', 'b', 'c']);
    expect(useSelection.getState().ids).toEqual(['a', 'b', 'c']);
  });
});
