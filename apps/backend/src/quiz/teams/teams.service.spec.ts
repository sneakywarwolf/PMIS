import { rankTeams } from './teams.service';

describe('rankTeams', () => {
  it('ranks by average points per member, counting members with no score as zero', () => {
    const teams = [
      { teamLeadId: 'a', name: 'Big', memberIds: ['a1', 'a2', 'a3', 'a4'] },
      { teamLeadId: 'b', name: 'Small', memberIds: ['b1', 'b2'] },
    ];
    // Big: 100 total / 4 members = 25; Small: 60 / 2 = 30 -> Small wins despite fewer total points.
    const points = new Map([['a1', 100], ['b1', 40], ['b2', 20]]);

    const rows = rankTeams(teams, points);

    expect(rows.map((r) => r.name)).toEqual(['Small', 'Big']);
    expect(rows[0]).toMatchObject({ score: 30, members: 2 });
    expect(rows[1].score).toBe(25);
  });
});
