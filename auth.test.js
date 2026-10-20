const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function page() {
  const elements = new Map();
  function node() {
    const classes = new Set();
    return { classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
      removeAttribute(name) { delete this[name]; }, querySelector() { return node(); }, addEventListener() {} };
  }
  const context = vm.createContext({ URL, document: { getElementById(id) {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  } } });
  vm.runInContext(fs.readFileSync('auth.js', 'utf8'), context);
  return { context, elements };
}
test('re-auth link uses the resolved participant and MongoDB ObjectId', () => {
  const { context, elements } = page();
  context.showSuccess({ res_id: 'RES6202', object_id: '68117dc3c40f7142e77199d8' });
  assert.equal(elements.get('reauth-link').href, 'https://resetnus.com/data?reset_id=RES6202&object_id=68117dc3c40f7142e77199d8');
  assert.equal(elements.get('reauth-container').classList.contains('hidden'), false);
});
test('new lookup, failures and records without ObjectId clear the old re-auth link', () => {
  for (const action of ['reset', 'error', 'missing', 'invalid']) {
    const { context, elements } = page();
    context.showSuccess({ res_id: 'RES6202', object_id: '68117dc3c40f7142e77199d8' });
    if (action === 'reset') context.resetCards();
    if (action === 'error') context.showError('Not found');
    if (action === 'missing') context.showSuccess({ res_id: 'RES0001' });
    if (action === 'invalid') context.showSuccess({ res_id: 'RES0001&other=1', object_id: '68117dc3c40f7142e77199d8' });
    assert.equal(elements.get('reauth-link').href, undefined);
    assert.equal(elements.get('reauth-container').classList.contains('hidden'), true);
  }
});
