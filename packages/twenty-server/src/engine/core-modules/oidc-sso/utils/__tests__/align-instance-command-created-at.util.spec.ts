import { planInstanceCommandCreatedAtAlignment } from 'src/engine/core-modules/oidc-sso/utils/align-instance-command-created-at.util';

const atSecond = (second: number) =>
  new Date(Date.UTC(2026, 10, 9, 14, 2, second));

describe('planInstanceCommandCreatedAtAlignment', () => {
  const sequenceNames = ['a', 'oidc', 'b', 'c'];

  it('does nothing when the newest row is the furthest in the sequence', () => {
    const rows = [
      { id: '1', name: 'a', createdAt: atSecond(1) },
      { id: '2', name: 'oidc', createdAt: atSecond(2) },
      { id: '3', name: 'b', createdAt: atSecond(3) },
    ];

    expect(
      planInstanceCommandCreatedAtAlignment({ rows, sequenceNames }),
    ).toBeNull();
  });

  it('moves only the misplaced newest row between its sequence neighbours', () => {
    const rows = [
      { id: '1', name: 'a', createdAt: atSecond(1) },
      { id: '3', name: 'b', createdAt: atSecond(5) },
      { id: '4', name: 'c', createdAt: atSecond(7) },
      { id: '2', name: 'oidc', createdAt: atSecond(9) },
    ];

    expect(
      planInstanceCommandCreatedAtAlignment({ rows, sequenceNames }),
    ).toEqual({ id: '2', createdAt: atSecond(3) });
  });

  it('uses the next row minus a margin when the misplaced row has no predecessor', () => {
    const rows = [
      { id: '3', name: 'b', createdAt: atSecond(5) },
      { id: '2', name: 'a', createdAt: atSecond(9) },
    ];

    const update = planInstanceCommandCreatedAtAlignment({
      rows,
      sequenceNames,
    });

    expect(update?.id).toBe('2');
    expect(update!.createdAt.getTime()).toBeLessThan(atSecond(5).getTime());
  });

  it('picks neighbours by sequence index, not by position in the input', () => {
    const rows = [
      { id: '2', name: 'oidc', createdAt: atSecond(9) },
      { id: '3', name: 'b', createdAt: atSecond(5) },
      { id: '1', name: 'a', createdAt: atSecond(1) },
    ];

    expect(
      planInstanceCommandCreatedAtAlignment({ rows, sequenceNames }),
    ).toEqual({ id: '2', createdAt: atSecond(3) });
  });

  it('ignores commands that are not in the sequence', () => {
    const rows = [
      { id: '1', name: 'gone', createdAt: atSecond(9) },
      { id: '2', name: 'a', createdAt: atSecond(1) },
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
