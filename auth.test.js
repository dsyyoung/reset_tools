const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function page(writeText) {
  const elements = new Map();
  const copied = [];
  function node() {
    const classes = new Set();
    return { events: {}, classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
      querySelector() { return node(); }, addEventListener(event, handler) { this.events[event] = handler; } };
  }
  const context = vm.createContext({ URL, navigator: { clipboard: { writeText: writeText || (async text => copied.push(text)) } }, document: { getElementById(id) {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  } } });
  vm.runInContext(fs.readFileSync('auth.js', 'utf8'), context);
  return { context, elements, copied };
}
const participant = { res_id: 'RES6202', object_id: '68117dc3c40f7142e77199d8' };
test('re-auth button copies the participant URL without a navigation link', async () => {
  const { context, elements, copied } = page();
  context.showSuccess(participant);
  await elements.get('reauth-link').events.click();
  assert.deepEqual(copied, ['https://resetnus.com/data?reset_id=RES6202&object_id=68117dc3c40f7142e77199d8']);
  assert.equal(elements.get('reauth-copy-status').textContent, 'Re-auth link copied.');
  assert.match(fs.readFileSync('auth.html', 'utf8'), /<button id="reauth-link"[^>]*type="button"/);
});
test('new lookups and invalid results cannot copy the previous participant URL', async () => {
  for (const action of ['reset', 'error', 'missing', 'invalid']) {
    const { context, elements, copied } = page();
    context.showSuccess(participant);
    if (action === 'reset') context.resetCards();
    if (action === 'error') context.showError('Not found');
    if (action === 'missing') context.showSuccess({ res_id: 'RES0001' });
    if (action === 'invalid') context.showSuccess({ ...participant, res_id: 'RES0001&other=1' });
    await elements.get('reauth-link').events.click();
    assert.deepEqual(copied, []);
    assert.equal(elements.get('reauth-container').classList.contains('hidden'), true);
  }
});
test('clipboard errors display a retry message', async () => {
  const { context, elements } = page(async () => { throw new Error('Denied'); });
  context.showSuccess(participant);
  await elements.get('reauth-link').events.click();
  assert.equal(elements.get('reauth-copy-status').textContent, 'Could not copy the link. Please try again.');
});
