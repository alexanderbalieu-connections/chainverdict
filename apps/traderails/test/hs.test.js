import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHs } from '../src/hs.js';

test('HS classify: ranks the obvious heading first', () => {
  assert.equal(classifyHs('running shoes')?.candidates[0]?.hsHeading, '6404');
  assert.equal(classifyHs('laptop computer')?.candidates[0]?.hsHeading, '8471');
  assert.equal(classifyHs('smartphone')?.candidates[0]?.hsHeading, '8517');
  assert.equal(classifyHs('wooden office desk')?.candidates[0]?.hsHeading, '9403');
  assert.equal(classifyHs('bottle of red wine')?.candidates[0]?.hsHeading, '2204');
});

test('HS classify: always carries the broker disclaimer + GRI note', () => {
  const r = classifyHs('coffee beans');
  assert.match(r.disclaimer, /licensed customs broker/);
  assert.match(r.griNote, /General Rules of Interpretation/);
  assert.equal(r.candidates[0].hsHeading, '0901');
});

test('HS classify: unknown goods -> none, honest coverage note', () => {
  const r = classifyHs('enriched uranium hexafluoride');
  assert.equal(r.confidence, 'none');
  assert.match(r.coverage, /does not cover/);
});
