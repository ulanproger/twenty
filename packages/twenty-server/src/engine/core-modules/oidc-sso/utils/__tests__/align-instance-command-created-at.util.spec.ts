import { planInstanceCommandCreatedAtAlignment } from 'src/engine/core-modules/oidc-sso/utils/align-instance-command-created-at.util';

const at = (second: number) => new Date(Date.UTC(2026, 10, 9, 14, 2, second));

describe('planInstanceCommandCreatedAtAlignment', () => {
  const sequenceNames = ['a', 'oidc', 'b', 'c'];

  it('does nothing when the newest row is the furthest in the sequence', () => {
    const rows = [
      { id: '1', name: 'a', createdAt: at(1) },
      { id: '2', name: 'oidc', createdAt: at(2) },
      { id: '3', name: 'b', createdAt: at(3) },
    ];

    expect(
      planInstanceCommandCreatedAtAlignment({ rows, sequenceNames }),
    ).toBeNull();
  });

  it('moves only the misplaced newest row between its sequence neighbours', () => {
    const rows = [
      { id: '1', name: 'a', createdAt: at(1) },
      { id: '3', name: 'b', createdAt: at(5) },
      { id: '4', name: 'c', createdAt: at(7) },
      { id: '2', name: 'oidc', createdAt: at(9) },
    ];

    expect(
      planInstanceCommandCreatedAtAlignment({ rows, sequenceNames }),
    ).toEqual({ id: '2', createdAt: at(3) });
  });

  it('uses the next row minus a margin when the misplaced row has no predecessor', () => {
    const rows = [
      { id: '3', name: 'b', createdAt: at(5) },
      { id: '2', name: 'a', createdAt: at(9) },
    ];

    const update = planInstanceCommandCreatedAtAlignment({
      rows,
      sequenceNames,
    });

    expect(update?.id).toBe('2');
    expect(update!.createdAt.getTime()).toBeLessThan(at(5).getTime());
  });

  it('picks neighbours by sequence index, not by time', () => {
    const rows = [
      { id: '1', name: 'a', createdAt: at(8) },
      { id: '3', name: 'b', createdAt: at(2) },
      { id: '2', name: 'oidc', createdAt: at(9) },
    ];

    expect(
      planInstanceCommandCreatedAtAlignment({ rows, sequenceNames }),
    ).toEqual({ id: '2', createdAt: at(5) });
  });

  it('ignores commands that are not in the sequence', () => {
    const rows = [
      { id: '1', name: 'gone', createdAt: at(9) },
      { id: '2', name: 'a', createdAt: at(1) },
    ];

    expect(
      planInstanceCommandCreatedAtAlignment({ rows, sequenceNames }),
    ).toBeNull();
  });

  it('does nothing without rows', () => {
    expect(
      planInstanceCommandCreatedAtAlignment({ rows: [], sequenceNames }),
    ).toBeNull();
  });
});
