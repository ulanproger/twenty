import { planInstanceCommandCreatedAtAlignment } from 'src/engine/core-modules/oidc-sso/utils/align-instance-command-created-at.util';

const at = (second: number) => new Date(Date.UTC(2026, 10, 9, 14, 2, second));

describe('planInstanceCommandCreatedAtAlignment', () => {
  const sequenceNames = ['a', 'oidc', 'b', 'c'];

  it('does nothing when timestamps already follow the sequence', () => {
    const rows = [
      { id: '1', name: 'a', createdAt: at(1) },
      { id: '2', name: 'oidc', createdAt: at(2) },
      { id: '3', name: 'b', createdAt: at(3) },
    ];

    expect(
      planInstanceCommandCreatedAtAlignment({ rows, sequenceNames }),
    ).toEqual([]);
  });

  it('moves an out-of-order command back so the furthest one is the newest', () => {
    const rows = [
      { id: '1', name: 'a', createdAt: at(1) },
      { id: '3', name: 'b', createdAt: at(3) },
      { id: '4', name: 'c', createdAt: at(4) },
      { id: '2', name: 'oidc', createdAt: at(9) },
    ];

    expect(
      planInstanceCommandCreatedAtAlignment({ rows, sequenceNames }),
    ).toEqual([
      { id: '2', createdAt: at(3) },
      { id: '3', createdAt: at(4) },
      { id: '4', createdAt: at(9) },
    ]);
  });

  it('ignores commands that are not in the sequence', () => {
    const rows = [
      { id: '1', name: 'gone', createdAt: at(9) },
      { id: '2', name: 'a', createdAt: at(1) },
    ];

    expect(
      planInstanceCommandCreatedAtAlignment({ rows, sequenceNames }),
    ).toEqual([]);
  });
});
