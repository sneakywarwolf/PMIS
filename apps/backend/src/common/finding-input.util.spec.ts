import { BadRequestException } from '@nestjs/common';
import { assertFindingInput } from './finding-input.util';

describe('assertFindingInput', () => {
  it('accepts what the project page sends, and partial updates', () => {
    expect(() => assertFindingInput({ projectId: 'p', testerNotes: 'n', affectedInstances: ['10.0.0.1:443'], cvssScoreOverride: 7.5, cvssVectorOverride: '', reportStatus: 'Open' })).not.toThrow();
    expect(() => assertFindingInput({ status: 'DRAFT' })).not.toThrow();
    expect(() => assertFindingInput({ cvssScoreOverride: null, proofOfConcept: null })).not.toThrow();
  });

  it.each([
    [{ testerNotes: { $gt: '' } }],
    [{ proofOfConcept: 5 }],
    [{ reportStatus: ['Open'] }],
    [{ affectedInstances: 'a,b' }],
    [{ affectedInstances: [1, 2] }],
    [{ affectedInstances: [{ x: 1 }] }],
    [{ cvssScoreOverride: '7' }],
    [{ cvssScoreOverride: 11 }],
    [{ cvssScoreOverride: -1 }],
    [{ cvssScoreOverride: Infinity }],
    [{ cvssScoreOverride: NaN }],
    [{ testerNotes: 'x'.repeat(200_001) }],
    [{ affectedInstances: new Array(20_001).fill('a') }],
    [null],
    [[]],
  ])('rejects %j', (body) => {
    expect(() => assertFindingInput(body)).toThrow(BadRequestException);
  });
});
