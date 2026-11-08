import { describe, expect, it } from 'vitest';
import { scriptedDialogue } from '../../server/features/interstitials/scripted-dialogue';

const tag = (text: string) => `<d>[English] ${text}</d>`;
describe('requested dialogue inventory', () => {
  it('captures tagged and ordinary quoted speech in sequence before enhancement', () => {
    expect(scriptedDialogue(`She says "Hello!" Then she asks ${tag('A rock?')} and asks brightly: “or this sock”.`))
      .toEqual([tag('Hello!'), tag('A rock?'), tag('or this sock')]);
  });
  it('preserves repeated utterances and quotes inside dialogue without counting them twice', () => {
    expect(scriptedDialogue(`She says "Go!" and says "Go!" Then ${tag('She says "Hello".')} ${tag('Go!')}`))
      .toEqual([tag('Go!'), tag('Go!'), tag('She says "Hello".'), tag('Go!')]);
    expect(scriptedDialogue('She says "Go!" and says "Go!"')).toEqual([tag('Go!'), tag('Go!')]);
    expect(scriptedDialogue(`${tag('Go!')} ${tag('Go!')}`)).toEqual([tag('Go!'), tag('Go!')]);
  });
  it.each(['Correction: she says "or this sock" while holding it.', 'Restore the missing spoken line: “or this sock”.', 'Add the missing line "or this sock".'])(
    'recognizes an explicit addition after an old H3 soundscape: %s', correction => {
      expect(scriptedDialogue(`${tag('A rock?')}\noverall_soundscape: Quiet.\nnon_diegetic_music: N/A\n${correction}`, true))
        .toEqual([tag('A rock?'), tag('or this sock')]);
    });
  it('keeps a quoted staging correction from duplicating an existing tagged utterance', () => {
    expect(scriptedDialogue(`${tag('A rock?')} ${tag('Old vegetables?')}\noverall_soundscape: Echo ${tag('A rock?')}\nCorrection: she asks "A rock?" while holding the rock. Then she asks "or this sock" while holding the sock.`, true))
      .toEqual([tag('A rock?'), tag('Old vegetables?'), tag('or this sock')]);
  });
  it.each(['The sign says "EXIT".', 'The sign that says "EXIT".', 'Her shirt says “HELLO”.', 'A screen displays "Ready".', 'Do not say "Oops".', 'She never says "Oops".', 'She lifts the "magic sock".', 'She picks up the sock and gives it a doubtful sid'])('does not invent requested speech from %s', draft => {
    expect(scriptedDialogue(draft)).toEqual([]);
  });
});
